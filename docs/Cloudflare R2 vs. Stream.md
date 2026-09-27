# Video delivery: R2, Cloudflare Stream and AWS S3

Pricing and capabilities checked on 2026-09-27. Amounts are USD, excluding tax.
This replaces the earlier comparison's conflicting $1.20 and $7.18 R2 totals
and unsupported claims of guaranteed caching or flawless playback.
The proposed catalog and metadata model are in
[ADR-0001](adr/0001-use-d1-for-video-catalog.md).

## Decision summary

Support all three backends per video, not as a catalog-wide storage switch.
R2 is the first/default ingest and playback backend. Start with validated
progressive MP4; add HLS packaging next. Use Stream optionally when managed
encoding and delivery reduce operational work. Use R2
for inexpensive object storage and delivery when we can operate the encoding,
packaging and player pipeline. Support S3 for existing AWS libraries, retention
requirements and AWS-based processing; use CloudFront for production adaptive
delivery rather than exposing an S3 bucket.

R2 and S3 are object stores. Stream is a managed video service, not an
interchangeable S3 API endpoint. Share catalog, access and playback contracts,
but keep provider-specific ingestion, locators and capabilities explicit.
Retain an original master in R2 or S3 if preservation or re-encoding matters.
A Stream copy is not a substitute for a recoverable original master.

## Functional comparison

| Capability | R2 with delivery Worker | Cloudflare Stream | AWS S3 with CloudFront |
| --- | --- | --- | --- |
| Stored material | Original files, MP4, HLS/DASH packages, captions | Managed video asset identified by UID | Original files, MP4, HLS/DASH packages, captions |
| Encoding and packaging | External FFmpeg or another encoder required | Managed H.264 adaptive encoding, documented 360p to 1080p range | External FFmpeg or separately billed MediaConvert required |
| Playback | MP4 with byte ranges; HLS/DASH only after packaging | HLS/DASH; built-in player or compatible own player | MP4 with byte ranges; HLS/DASH only after packaging |
| Codec and ladder control | We choose, within player/device support | Provider-managed output and limits | We choose, within player/device support |
| CDN | Explicit Worker cache design; bucket binding alone does not cache | Included video delivery network | Separate CloudFront distribution and cache policy |
| Restricted access | Private bucket; Worker validates media-session grants | `requireSignedURLs` plus signed playback tokens | Private S3 origin with OAC; CloudFront signed cookies/URLs |
| Long-form playback | Renewable grant covers manifests and all child assets | Token lifetime or tested renewal must cover the viewing session | Renewable signed cookies cover the entire package path |
| Captions and thumbnails | Generate, store, associate and serve ourselves | Managed caption/thumbnail features; import into catalog | Generate ourselves or use separate AWS services |
| Readiness | Upload is not proof of playable media; validate package first | Asynchronous processing status, webhook and reconciliation | Upload is not proof of playable media; validate package first |
| Analytics | Player telemetry and infrastructure metrics are our responsibility | Built-in video analytics; common player telemetry still useful | CloudFront/S3 metrics plus our player telemetry |
| Preservation and portability | Retain original bytes and portable packages | Generated MP4/audio downloads available; not an original-file archival contract | Retain original bytes; S3 Versioning/Object Lock available when configured |
| Live video | No managed ingest/transcoding service | Managed live video available | S3 alone is not a live pipeline; separate services required |
| Main operational burden | Encoder, package validation, player, authorization, cache | Provider integration, access, synchronization and monitoring | Same media work as R2, plus AWS/CDN configuration |

There is no documented Stream feature that writes its complete adaptive ladder
directly into our R2 or S3 bucket. A generated Stream MP4 download can be copied
and re-encoded, with delivery and compute costs; it is not a free export of the
original or a managed Stream-to-R2 HLS/DASH pipeline.

## Cost assumptions

Retain the earlier comparison's lecture workload:

- 100 hours stored: 6,000 minutes.
- 1,000 hours delivered monthly: 60,000 minutes. Treat this as delivered media,
  not just watch time; Stream also bills prefetching and buffering.
- Three muxed audio/video renditions: 0.90, 0.45 and 0.20 decimal GB/hour.
  Together these occupy approximately 155 GB. This excludes a separate master,
  packaging overhead, captions and thumbnails.
- Delivery averages 2 Mbps including audio, or 0.90 GB/hour: 900 decimal GB
  monthly. A viewer downloads the selected rendition, not all three ladders.
- Four-second segments give 900,000 segment requests. Budget 1 million total
  media requests for manifests, seeking and retries. Separate audio tracks can
  increase this; measure the actual package.
- Steady state, no new encoding or uploads, no assumed cache savings. AWS storage
  is S3 Standard in `us-east-1`; archive retrieval tiers are not compared.

The size formula is `hours * 3600 * bitrate_Mbps / 8 / 1000` decimal GB.
Thus 1,000 minutes at 2 Mbps occupy 15 GB, not a fixed size implied by 720p.
Motion, encoding settings and required visual quality determine the bitrate.
AWS bills storage in binary GB: 155 decimal GB is about 144.35 GiB, and
900 decimal GB is about 838.19 GiB.

### Published rates

| Item | Rate and qualification |
| --- | --- |
| Stream storage | $5/month per 1,000 minutes of purchased capacity; all generated quality levels included |
| Stream delivery | $1 per 1,000 minutes delivered; encoding included |
| R2 Standard | $0.015/GB-month; $4.50/million Class A writes/lists; $0.36/million Class B reads; no egress charge |
| R2 monthly allowance | 10 GB-month, 1 million Class A and 10 million Class B operations, shared across the account |
| Workers Paid | $5/account/month; 10 million requests and 30 million CPU milliseconds included; overages billed separately |
| S3 Standard, N. Virginia | $0.023/binary GB-month in the first 50 TB; $0.005/1,000 PUT/LIST; $0.0004/1,000 GET |
| Direct AWS internet transfer | First 100 GB/month shared allowance where applicable, then $0.09/GB in the first charged 10 TB tier |
| S3 to CloudFront origin fetches | No origin data-transfer charge; S3 GET charges still apply |
| CloudFront pay-as-you-go | Monthly allowance of 1 TB internet transfer and 10 million HTTP(S) requests; overages depend on viewer geography |

R2 rounds usage up to billing units, including whole millions of operations.
The $0.00036 per 1,000 reads often quoted is a prorated rate, not necessarily
the invoice increment. Its free tier applies to Standard, not Infrequent Access.
Infrequent Access adds retrieval fees and minimum retention, so it is not the
default serving tier.

### Monthly example with unused shared allowances

The table compares media services only. D1, search, the catalog API and its
authorization endpoint are common costs and excluded for every option.
The R2 column conservatively allocates the entire $5 Worker plan to its media
gateway; if the catalog already pays it, the marginal R2 cost is $5 lower.

| Cost | Stream | R2 + Worker | S3 direct, no CDN | S3 + CloudFront |
| --- | ---: | ---: | ---: | ---: |
| Video storage | $30.00 | $2.18 | $3.32 | $3.32 |
| Delivery/egress | $60.00 | $0.00 | $66.44 | $0.00 |
| Reads, up to 1 million origin GETs | Included | $0.00 | $0.40 | $0.40 |
| Dedicated media gateway plan | Included | $5.00 | Not included | $0.00 |
| **Estimated media subtotal** | **$90.00** | **$7.18** | **$70.16** | **$3.72** |

Calculations, retaining precision until totals are rounded:

```text
Stream = ceil(6000 / 1000) * $5 + 60000 / 1000 * $1 = $90
R2     = (155 - 10) * $0.015 + $5 = $7.175
S3 storage = (155 * 10^9 / 2^30) * $0.023 = $3.3202
S3 direct transfer = (900 * 10^9 / 2^30 - 100) * $0.09 = $66.4371
S3 GETs = 1000000 / 1000 * $0.0004 = $0.40
```

The S3 direct column is a transport baseline, not the recommended private HLS
architecture: protecting every object still needs a delivery/authentication
solution. The CloudFront column includes its signed-cookie capability and
assumes its shared transfer/request allowances are unused. It uses zero cache
hits as a conservative upper bound for origin GETs, not a predicted hit rate.
S3 introductory credits/free storage are excluded.

At this workload, S3 plus unused CloudFront allowances can cost less than R2
plus a newly allocated Worker plan. It would be misleading to use S3 direct
egress pricing as the only AWS alternative. Once CloudFront allowances are
consumed, regional CDN delivery/request costs return. R2's egress remains free
beyond its storage and operation allowances.

### Costs outside the subtotal

Encoding and operations are the main difference, not just storage:

- R2 and S3 require encoder compute, job orchestration, package validation,
  retries and maintenance. Price the actual FFmpeg host or MediaConvert profile;
  no compute estimate is possible from duration alone.
- Initially writing three four-second rendition ladders requires roughly
  `100 * 3600 / 4 * 3 = 270,000` segment PUTs, plus manifests. With unused
  allowances that fits R2 Class A; S3 PUTs cost about $1.35. Re-encoding repeats
  these writes and may temporarily duplicate storage.
- Preserving a separate 90 GB source adds storage. Keeping Stream and R2/S3
  copies adds both storage charges; delivered minutes/bytes are charged only
  on the selected delivery path.
- Workers execute authorization even when a media payload is cached. At an
  assumed 5 ms CPU/request, 1 million requests uses 5 million CPU ms, within
  the plan allowance. This is a budget assumption to measure, not a benchmark.
- Logging, queues, KMS, optional CDN features, source retrieval, cross-provider
  copies, backups and engineering/on-call costs are additional.

Without unused R2 allowances, this same workload is about $7.69 before uploads:
`155 * $0.015 + $0.36 + $5`, using one billed million Class B reads.
Actual incremental billing depends on other account usage and rounding.

## Access and caching corrections

A signed manifest URL does not authorize its referenced segments. Relative
segment URLs do not inherit the manifest's query-string signature. Every
manifest, segment, init file, caption and encryption key must be authorized.

A 60-second URL is useful to start a session, not as a static grant for an
entire two-hour adaptive video. Use renewable, package-scoped cookies for R2
and CloudFront, or Stream tokens with a sufficient lifetime and tested renewal.
Expiry is checked on subsequent requests, so even a progressively downloaded
MP4 can fail on a later seek/range request. Renewal must recheck catalog access;
cookie expiry does not renew itself.

Keep origins private. A custom domain does not automatically cache Worker
binding reads. Validate authorization before looking up cached media, then use
an immutable asset/path cache key independent of the viewer's token. Never
cache session responses or `Set-Cookie` headers as public content. Test range
responses, CORS and credentialed browser/native playback.

Cache hits vary by location, popularity, eviction and TTL. Do not promise one
origin fetch globally or assume an 80-90% hit rate without measurements.
R2 S3-presigned URLs target its S3 API endpoint, not a cached custom domain.
For S3, CloudFront signed cookies and origin access control are different
mechanisms from S3 presigning.

## User experience and choice

Stream reduces the amount of encoding and player integration we own; it does
not guarantee no buffering or perfect device compatibility. An R2 or S3 package
can offer comparable playback when its codecs, keyframe alignment, bitrate
ladder, segment sizes, CDN and player are well configured. ABR selection is
primarily a player behavior, not a magical property of the storage service.

Qualify all backends with the same fixtures and player/device matrix: iOS
Safari, Android Chrome and desktop browsers; slow/changing networks; subtitles;
startup and seek latency; rebuffering ratio; and a two-hour session crossing
grant expiry. Test cold and warm caches separately. Record backend and asset
IDs with measurements so differences are attributable.

Start with R2 ingestion and validated MP4 playback, then add a validated R2
adaptive encoding pipeline. Add Stream and S3/CloudFront as optional copies. Choose
the preferred ready copy per content version using operational cost and measured
playback quality, not a permanent provider assumption in the video row.
The default ordering does not imply R2 is always cheapest: the cost table
compares adaptive packages with shared allowances, not the simpler MP4-first
release. The catalog's default is an operational choice, not a universal cost claim.

## Sources

- [Stream overview and encoding](https://developers.cloudflare.com/stream/)
- [Stream pricing](https://developers.cloudflare.com/stream/pricing/)
- [Stream downloads](https://developers.cloudflare.com/stream/viewing-videos/download-videos/)
- [Stream signed playback](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/)
- [R2 pricing and rounding](https://developers.cloudflare.com/r2/pricing/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [S3 pricing and billing units](https://aws.amazon.com/s3/pricing/)
- [S3 regional price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json)
- [AWS transfer regional price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/us-east-1/index.json)
- [CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)
- [CloudFront signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
- [CloudFront S3 origin access control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
