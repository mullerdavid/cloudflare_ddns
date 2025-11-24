#!/bin/sh

URL="https://<worker-name>.<worker-subdomain>.workers.dev/webhook"
TOKEN="ENCRYPTED+TOKEN"
ACL="aclname"
ZONE="mydomain.org"

action="$1"
domain="$2"
fqdn="$3"
challenge="$4"

curl -s -X POST -H "Content-Type: application/json" "$URL" -d @- <<JSON
{
  "action": "$action",
  "record": {
    "name": "$fqdn",
    "type": "TXT",
    "content": "$challenge"
  },
  "zone": "$ZONE",
  "acl": "$ACL",
  "token": "$TOKEN"
}
JSON
