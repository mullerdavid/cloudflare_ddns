# Cloudflare DDNS middleware

Cloudflare worker for various DNS api wrappers.

Create worker and add the js to enable. 

As Cloudflare API tokens are limited to a full site, for more fine grained control, add environment variables to control ACL. If no ACL is specified, the token is used as is.

## ACL

The ACLs can be added as environment variables with `ACL_` prefix (for example ACL named test should have the key `ACL_test`) as json values `{"key": "keyBase64", "filter": "regexFilter"}`. The key is base64 encoded and 128 bits long. The filter is a regex.

The config is looked up based on the ACL key (see protocol details) and the token is decrypted from the supplied base64 one if the records are matching the regex filter. This way neither the worker nor the client can update the records alone, and the middleware is enforcing the filters.

# API documentation

## DDNS protocol

The endpoint is compatible with various DDNS protocols used by providers. It can update a single __existing__  dns record(s) to the specified ip.

The endpoint is available under the following paths:
- `/nic/update`
- `/update`
- `/auth/dynamic.html`

Query parameters:
- `host` or `hostname` to specify the domain(s) to update, for multiple domains, just separate them with `,` coma
- `ip` or `myip` or `dnsto` to specify the ip 

The credentials are passed as part of the basic authentication:
- `username` part should contain the Cloudflare zone name, with an optional ACL name separated with `,` coma
- `password` part should contain the Cloudflare API token, or the encrypted variant if ACL was specified

### Examples
```bash
curl -v "https://mydomain.org:${CLOUDFLARE_API_TOKEN}@<worker-name>.<worker-subdomain>.workers.dev/update?host=subdomain.mydomain.org&ip=10.10.10.10"
curl -v "https://mydomain.org,aclname:${ENCRYPTED_TOKEN}@<worker-name>.<worker-subdomain>.workers.dev/update?host=subdomain.mydomain.org,sub2.mydomain.org&ip=10.10.10.10"
```

## Webhook updater

Simple webhook to set or unset records. Designed to use with the ACME DNS challenge.

The endpoint is available under `/webhook` endpoint. 

It expects a `POST` with `Content-Type: application/json`.
```json
{
	"action":"set|unset", 
	"record": {
		"name": "name", 
		"type": "A|TXT|CNAME", 
		"content": "ip|dns|txt"
	}, 
	"zone": "zone", 
	"acl": "optional_acl", 
	"token": "token"
}
```

The `action` can be `set` or `unset`. The `record` format is similar to the Cloudflare API one, but only the values above are handled. The `zone` is the zone name, `acl` is the optional ACL name. The `token` is the Cloudflare API token, or the encrypted variant if ACL was specified.

### Examples

```bash
curl -v -X POST -H "Content-Type: application/json" "https://<worker-name>.<worker-subdomain>.workers.dev/webhook" -d @- <<JSON
{
	"action":"set", 
	"record": {
		"name": "_sub.mydomain.org", 
		"type": "TXT", 
		"content": "somesecretvalue"
	}, 
	"zone": "mydomain.org", 
	"token": "${CLOUDFLARE_API_TOKEN}"
}
JSON
curl -v -X POST -H "Content-Type: application/json" "https://<worker-name>.<worker-subdomain>.workers.dev/webhook" -d @- <<JSON
{
	"action":"unset", 
	"record": {
		"name": "_sub.mydomain.org", 
		"type": "TXT", 
		"content": "somesecretvalue"
	}, 
	"zone": "mydomain.org", 
	"acl": "aclname", 
	"token": "${ENCRYPTED_TOKEN}"
}
JSON
```

## ACL Token Encryption

This can be used to get the encrypted token for a given ACL without manually encrypting.

The endpoint is available under `/encrypt` endpoint.

It expects a `POST` with `Content-Type: application/json`.
```json
{
	"acl":"acl",
	"token":"cloudflare-token"
}
```

The `acl` is the acl set up with the environment variable on the worker. The `token` is the Cloudflare API token.

### Example

```bash
curl -v -X POST -H "Content-Type: application/json" "https://<worker-name>.<worker-subdomain>.workers.dev/encrypt" -d @- <<JSON
{
	"acl": "aclname",
	"token": "${CLOUDFLARE_API_TOKEN}"
}
JSON
```

# Unifi (ddclient) Config
Works with Unifi (or anything that is using ddclient).

```
service: choose any
hostname: the name of the record(s) you want to update separated by coma (e.g. `subdomain.mydomain.org` or `subdomain.mydomain.org,*.subdomain.mydomain.org`)
username: the name of the zone where the record is defined. (e.g. `mydomain.org`), optionally with a
password: a Cloudflare api token with dns:edit and zone:read permissions
server: the Cloudflare Worker DNS plus the path `<worker-name>.<worker-subdomain>.workers.dev/update?hostname=%h&ip=%i`
```
  
## Notes for devices older than UDM
```
service: choose from any of the following:  "dyndns", "noip", "zoneedit"
server: the Cloudflare Worker DNS "<worker-name>.<worker-subdomain>.workers.dev"
```

# Original work
Based on <https://github.com/workerforce/unifi-ddns>
