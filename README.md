# Cloudflare DDNS proxy
Cloudflare worker to proxy DDNS updates to their API.
Create worker

## Config
    service: choose any
    hostname: the name of the record you want to update (e.g. subdomain.mydomain.org)
    username: the name of the zone where the record is defined. (e.g. mydomain.org)
    password: a Cloudflare api token with dns:edit and zone:read permissions
    server: the Cloudflare Worker DNS plus the path <worker-name>.<worker-subdomain>.workers.dev/update?hostname=%h&ip=%i
  
## Notes for devices oldare than UDM
    service: choose from any of the following:  dyndns, noip, zoneedit
    server: the Cloudflare Worker DNS <worker-name>.<worker-subdomain>.workers.dev

# Original work
Based on <https://github.com/workerforce/unifi-ddns>
