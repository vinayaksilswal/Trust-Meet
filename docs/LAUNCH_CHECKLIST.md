# Public launch checklist

Code changes cannot cover these items. Complete them before you point a domain at the site and turn on indexing, ads or payments.

## Legal and business

- Register the business and fill in every `NEXT_PUBLIC_OPERATOR_*`, support and grievance variable. The policy pages show bracketed placeholders until you do.
- Have a lawyer qualified in Indian law review `/terms`, `/privacy`, `/refunds`, `/guidelines` and `/contact`. The text is a starting template.
- Appoint a Grievance Officer and meet the IT Rules, 2021 response times stated on `/contact`.
- Decide how you will meet the DPDP Act, 2023 duties: consent records, deletion requests and breach notices.

## Child safety and moderation

- The 18+ check is a self-reported date of birth. Random video chat services have been sued and shut down over minors and abuse. Before public traffic, add stronger age assurance and staffed moderation, and decide how you will detect nudity in video.
- Build the moderation console (report queue, suspend and appeal). Today reports are listed and accounts are suspended with the `conviya.moderation_ops` CLI.
- Write a procedure for preserving and reporting child sexual abuse material to Indian authorities (cybercrime.gov.in, 1930), as POCSO requires.

## Ads

- Google AdSense reviews the whole site. Sites built on unmoderated user video are often refused or later restricted. Apply only once moderation is running.
- Set `NEXT_PUBLIC_ADSENSE_CLIENT` and `NEXT_PUBLIC_ADSENSE_SLOT`. `/ads.txt` is then generated automatically.
- Ads appear only on the home and information pages. They never appear in calls, account pages or policy pages, and never for Plus members.
- For visitors from the EEA, UK or Switzerland, Google requires a certified consent management platform. The built-in banner is enough only for other regions.

## Search

- Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS domain and `NEXT_PUBLIC_SITE_INDEXABLE=true`. Until then robots.txt blocks all crawlers and the sitemap is empty.
- Verify the domain in Google Search Console and submit `/sitemap.xml`.

## Operations

- Load-test matchmaking and media with the expected peak number of users. Check TURN relay for mobile networks.
- Set up error monitoring, uptime alerts, database backups and a tested restore.
- See [Production readiness](PRODUCTION_READINESS.md) for open engineering gates.
