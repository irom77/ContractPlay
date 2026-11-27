# Set up `bridge.romaniuk.us`

This runbook tracks the move of ContractPlay's public online address from `contractplay.niuk.workers.dev` to `bridge.romaniuk.us`. The domain registration stays at Squarespace; Cloudflare becomes the DNS provider for `romaniuk.us` so the Cloudflare Worker can use a Custom Domain.

## Checkpoint (2026-11-27)

The `romaniuk.us` zone has been added to the Cloudflare Free account and its imported DNS records are being reviewed. Squarespace DNS screenshots show that Cloudflare's scan missed these four CNAME records:

| Name | Target |
|---|---|
| `h4qbyutkezni` | Google verification target shown in Squarespace |
| `irek` | `irom77.github.io` |
| `resend` | `resend.forge.rmta.net` |
| `send` | `send.forge.rmta.net` |

The exact Google verification target should be copied from Squarespace. Add the four records in Cloudflare with TTL `Auto` and proxy status `DNS only`. Cloudflare also showed the existing `mail`, `ftp`, and `_domainconnect` records as proxied; switch those records to `DNS only`. Compare the complete Cloudflare list against Squarespace before activating the zone, including all MX, TXT, and CNAME records.

**No nameserver change has been made. Do not switch nameservers until the records have been compared and the missing records added.** The Squarespace nameservers still control live DNS at this checkpoint.

## Steps to resume

1. **Finish the DNS record review.** Add the four missing CNAMEs above. Set `mail`, `ftp`, and `_domainconnect` to `DNS only`. Check the entire Squarespace DNS settings page against Cloudflare. Preserve the existing website and email records; registration remains at Squarespace.
   - Done when every Squarespace record needed by the website, email, and verification services has a matching Cloudflare record, with the email MX/TXT records intact.
2. **Activate the Cloudflare zone.** Continue to activation in Cloudflare and note the two nameservers it assigns to `romaniuk.us`.
   - Done when Cloudflare displays its assigned nameservers and the zone is ready for the registrar change.
3. **Change nameservers at Squarespace.** Open `romaniuk.us` → **DNS** → **Domain Nameservers** → **Use Custom Nameservers**. Enter the two Cloudflare nameservers exactly. Follow Squarespace's DNSSEC prompt; stale DNSSEC delegation can prevent the new DNS from resolving. Keep the registration at Squarespace.
   - Done when Squarespace shows the custom nameservers and Cloudflare reports the zone as **Active**. Propagation may take up to 48 hours.
4. **Attach the Worker hostname.** In Cloudflare, open **Workers & Pages** → `contractplay` → **Settings** → **Domains & Routes** → **Add** → **Custom Domain**. Enter `bridge.romaniuk.us`. Cloudflare manages the hostname's DNS record and certificate. Do not create a separate CNAME for this hostname; a Custom Domain cannot be attached if a CNAME already exists there.
   - Done when Cloudflare shows `bridge.romaniuk.us` attached and its certificate is ready.
5. **Persist the route in the repository.** In `apps/server/wrangler.jsonc`, add a route entry `{ "pattern": "bridge.romaniuk.us", "custom_domain": true }` and change `vars.AUTH_PUBLIC_ORIGIN` to `https://bridge.romaniuk.us`. Keep the existing email provider and sender configuration. Deploy the Worker so the route and origin setting persist in Wrangler configuration.
   - Done when the production Worker is deployed with the custom route and the new public origin.
6. **Verify the new public address.** Open `https://bridge.romaniuk.us`, complete a fresh email sign-in, and test an online table in two browser windows/devices. Confirm lobby access, table reconnection, and that the old `workers.dev` address still behaves as expected during the transition.
   - Done when sign-in links return to the new origin and two players can join and play at the custom address.

Changing `AUTH_PUBLIC_ORIGIN` changes the auth origin; existing sessions on the `workers.dev` origin do not transfer. Users may need to sign in again at the new address.

## References

- [Cloudflare Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare: onboard a domain](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)
- [Squarespace: change nameservers](https://support.squarespace.com/hc/en-us/articles/4404183898125-Review-change-or-reset-your-domain-s-nameservers)
- [Deployment runbook](platform-delivery.md#attaching-bridgeromaniukus-later)
