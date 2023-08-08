/*
Config

service: choose any
hostname: the name of the record(s) you want to update separated by coma (e.g. "subdomain.mydomain.org" or "subdomain.mydomain.org,\*.subdomain.mydomain.org")
username: the name of the zone where the record is defined. (e.g. "mydomain.org")
password: a Cloudflare api token with dns:edit and zone:read permissions
server: the Cloudflare Worker DNS plus the path "<worker-name>.<worker-subdomain>.workers.dev/update?hostname=%h&ip=%i"

Notes for devices oldare than UDM

service: choose from any of the following:  "dyndns", "noip", "zoneedit"
server: the Cloudflare Worker DNS "<worker-name>.<worker-subdomain>.workers.dev"

*/

class BadRequestException extends Error {
	constructor(reason) {
		super(reason);
		this.status = 400;
		this.statusText = "Bad Request";
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

	async updateRecord(record, value) {
		record.content = value;
		const response = await this._fetchWithToken(
			`zones/${record.zone_id}/dns_records/${record.id}`,
			{
				method: "PUT",
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

async function handleRequest(request) {
	requireHttps(request);
	const { pathname } = new URL(request.url);

	if (pathname === "/favicon.ico" || pathname === "/robots.txt") {
		return new Response(null, { status: 204 });
	}

	if (pathname !== "/nic/update" && pathname !== "/update" && pathname !== "/auth/dynamic.html") {
		return new Response("Not Found.", { status: 404 });
	}

	if (!request.headers.has("Authorization")) {
		throw new BadRequestException("Please provide valid credentials.");
	}

	const { username, password } = parseBasicAuth(request);
	const url = new URL(request.url);
	verifyParameters(url);

	const response = await informAPI(url, username, password);
	return response;
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

async function informAPI(url, name, token) {
	const hostname_str = url.searchParams.get("hostname") || url.searchParams.get("host");
	const hostnames = hostname_str.split(",");
	const ip = url.searchParams.get("ip") || url.searchParams.get("myip") || url.searchParams.get("dnsto");

	const cloudflare = new Cloudflare({ token });

	const zone = await cloudflare.findZone(name);
	for (const hostname of hostnames) {
		const record = await cloudflare.findRecord(zone, hostname);
		await cloudflare.updateRecord(record, ip);
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
		return handleRequest(request).catch((err) => {
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
