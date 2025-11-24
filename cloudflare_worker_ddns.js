class BadRequestException extends Error {
	constructor(reason) {
		super(reason);
		this.status = 400;
		this.statusText = "Bad Request";
	}
}

class AccessDeniedException extends Error {
	constructor(reason) {
		super(reason);
		this.status = 403;
		this.statusText = "Access Denied";
	}
}

class InternalException extends Error {
	constructor(reason) {
		super(reason);
		this.status = 500;
		this.statusText = "Internal Server Error";
	}
}

class CloudflareApiException extends Error {
	constructor(reason) {
		super(reason);
		this.status = 500;
		this.statusText = "Internal Server Error";
	}
}

class Cloudflare {
	constructor(options) {
		this.cloudflare_url = "https://api.cloudflare.com/client/v4";
		this.token = options.token;
	}

	async findZone(name) {
		const response = await this._fetchWithToken(`zones?name=${name}`);
		const body = await response.json();
		if (!body.success || body.result.length === 0) {
			throw new CloudflareApiException(`Failed to find zone '${name}'`);
		}
		return body.result[0];
	}

	async findRecord(zone, name) {
		const response = await this._fetchWithToken(`zones/${zone.id}/dns_records?name=${name}`);
		const body = await response.json();
		if (!body.success || body.result.length === 0) {
			throw new CloudflareApiException(`Failed to find dns record '${name}'`);
		}
		return body.result[0];
	}

	async updateRecord(zone, record, value) {
		record.content = value;
		const response = await this._fetchWithToken(
			`zones/${zone.id}/dns_records/${record.id}`,
			{
				method: "PATCH",
				body: JSON.stringify(record),
			}
		);
		const body = await response.json();
		if (!body.success) {
			throw new CloudflareApiException("Failed to update dns record");
		}
		return body.result[0];
	}

	async _fetchWithToken(endpoint, options = {}) {
		const url = `${this.cloudflare_url}/${endpoint}`;
		options.headers = {
			...options.headers,
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.token}`,
		};
		return fetch(url, options);
	}
}

async function decrypt(keyBase64, ciphertextBase64) {
	const FIXED_IV = new Uint8Array([0x7e, 0xed, 0xba, 0xe4, 0xfa, 0xa8, 0x41, 0x73, 0xfa, 0xde, 0xc0, 0x5c, 0xee, 0xa6, 0x9d, 0xff]);
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0)),
		{ name: "AES-CBC" },
		false,
		["decrypt"]
	);
	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-CBC", iv: FIXED_IV },
		cryptoKey,
		Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0))
	);
	return new TextDecoder().decode(decrypted);
}

async function encrypt(keyBase64, plaintext) {
	const FIXED_IV = new Uint8Array([0x7e, 0xed, 0xba, 0xe4, 0xfa, 0xa8, 0x41, 0x73, 0xfa, 0xde, 0xc0, 0x5c, 0xee, 0xa6, 0x9d, 0xff]);
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0)),
		{ name: "AES-CBC" },
		false,
		["encrypt"]
	);
	const encodedPlaintext = new TextEncoder().encode(plaintext);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-CBC", iv: FIXED_IV },
		cryptoKey,
		encodedPlaintext
	);
	return btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
}

function requireHttps(request) {
	const { protocol } = new URL(request.url);
	const forwardedProtocol = request.headers.get("x-forwarded-proto");

	if (protocol !== "https:" || forwardedProtocol !== "https") {
		throw new BadRequestException("Please use a HTTPS connection.");
	}
}

function parseBasicAuth(request) {
	const Authorization = request.headers.get("Authorization");
	const [scheme, data] = Authorization.split(" ");
	const decoded = atob(data);
	const index = decoded.indexOf(":");

	if (index === -1 || /[\0-\x1F\x7F]/.test(decoded)) {
		throw new BadRequestException("Invalid authorization value.");
	}

	return {
		username: decoded.substring(0, index),
		password: decoded.substring(index + 1),
	};
}

async function handleRequest(request, env) {
	requireHttps(request);
	const { pathname } = new URL(request.url);

	if (pathname === "/favicon.ico" || pathname === "/robots.txt") {
		return new Response(null, { status: 204 });
	}

	if (pathname === "/nic/update" || pathname === "/update" || pathname === "/auth/dynamic.html") {
		if (!request.headers.has("Authorization")) {
			throw new BadRequestException("Please provide valid credentials.");
		}

		const { username, password } = parseBasicAuth(request);
		const url = new URL(request.url);
		verifyParameters(url);

		const response = await informAPI(url, username, password, env);
		return response;
	}

	if (pathname === "/encrypt") {
		if (request.method === "POST") {
			const contentType = request.headers.get("content-type") || "";
			if (contentType.includes("application/json")) {
				const data = await request.json();
				const acl = data.acl;
				const token = data.token;
				console.log(data);
				if (acl && token)
				{
					const response = await encrypt_token_response(acl, token, env);
					return response;
				}
			}
		}
		throw new BadRequestException('Requires POST with application/json {"acl":"acl", "token":"cloudflare-token"}');
	}
	
	return new Response("Not Found.", { status: 404 });

}

function verifyParameters(url) {
	const { searchParams } = url;

	if (!searchParams) {
		throw new BadRequestException("You must include proper query parameters");
	}

	if (!(searchParams.get("hostname") || searchParams.get("host"))) {
		throw new BadRequestException("You must specify a hostname");
	}

	if (!(searchParams.get("ip") || searchParams.get("myip") || searchParams.get("dnsto"))) {
		throw new BadRequestException("You must specify an ip address");
	}
}

async function get_acl_config(acl, env) {
	const acl_obj = env[`ACL_${acl}`];
	if (!acl_obj) {
		throw new InternalException(`ACL '${acl}' missing from configuration.`);
	}
	const { key: keyBase64, filter } = acl_obj;
	if (!keyBase64 || !filter) {
		throw new InternalException(`ACL '${acl}' missing key or filter.`);
	}
	return [keyBase64, filter];
}
  


async function verify_decrypt_token(acl, hostnames, token, env) {
	const [keyBase64, filter] = await get_acl_config(acl, env);
	const filterRegex = new RegExp(filter);
	for (const hostname of hostnames) {
		if (!filterRegex.test(hostname)) {
			throw new AccessDeniedException(`Filter not matching for hostname '${hostname}' with ACL '${acl}'`);
		}
	}
	return await decrypt(keyBase64, token);
}

async function encrypt_token_response(acl, token, env) {
	const [keyBase64, filter] = await get_acl_config(acl, env);
	const encrypted_token = encrypt(keyBase64, token);
	return new Response(JSON.stringify({"encrypted_token":encrypted_token}), {
		status: 200,
		headers: {
			"Content-Type": "text/json;charset=UTF-8",
			"Cache-Control": "no-store",
		},
	});
}

async function informAPI(url, zone_acl, token, env) {
	const hostname_str = url.searchParams.get("hostname") || url.searchParams.get("host");
	const hostnames = hostname_str.split(",");
	const [zone, acl] = zone_acl.split(",");
	const ip = url.searchParams.get("ip") || url.searchParams.get("myip") || url.searchParams.get("dnsto");
	if (acl) {
		token = await verify_decrypt_token(acl, hostnames, token, env);
	}

	const cloudflare = new Cloudflare({ token });

	const zone_cf = await cloudflare.findZone(zone);
	for (const hostname of hostnames) {
		const record = await cloudflare.findRecord(zone_cf, hostname);
		await cloudflare.updateRecord(zone_cf, record, ip);
	}

	if (url.searchParams.get("dnsto")) {
		return new Response(`<SUCCESS CODE="200" TEXT="Update succeeded." IP="${ip}">`, {
			status: 200,
			headers: {
				"Content-Type": "text/plain;charset=UTF-8",
				"Cache-Control": "no-store",
			},
		});
	}

	return new Response(`good ${ip}`, {
		status: 200,
		headers: {
			"Content-Type": "text/plain;charset=UTF-8",
			"Cache-Control": "no-store",
		},
	});

}

export default {
	async fetch(request, env, ctx) {
		return handleRequest(request, env).catch((err) => {
			console.error(err.constructor.name, err);
			const message = err.reason || err.stack || "Unknown Error";

			return new Response(message, {
				status: err.status || 500,
				statusText: err.statusText || null,
				headers: {
					"Content-Type": "text/plain;charset=UTF-8",
					"Cache-Control": "no-store",
					"Content-Length": message.length,
				},
			});
		});
	},
};
