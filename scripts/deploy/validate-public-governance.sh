#!/usr/bin/env bash
set -Eeuo pipefail

# Versioned, fail-closed public readback for a governance publication.
# The release-specific copy under /opt/diesel/backups is reused to finalize
# PUBLISH_COMMITTED recovery without depending on a mutable runbook.

if [[ "$#" -ne 1 || ! "${1:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 <full-lowercase-git-commit-sha>" >&2
  exit 64
fi

validate_public_governance() {
release_id="${1:?expected app version is required}"
export release_id
public_origin="https://diesel.jamesky.site"
# Expected target/full graph closure: 97 jurisdictions / 28 regulations / 651 limits / 203 sources.
published_countries="CRI ECU PAN DOM PHL PAK SAU ARE ISR ZAF EGY GHA KEN RWA TZA ZMB ZWE CIV DZA TUN ETH CMR SEN NGA UGA BWA NAM SWZ KHM LAO LKA MMR MNG LIE SGP MAR QAT KWT OMN JOR IRN IRQ LBN SYR GUY HTI JAM BLZ CUB LBR LBY MLI MRT NER GTM HND NIC PRY URY PRK PSE SDN PRI NCL ERI GAB GMB GNB GNQ MOZ LSO MDG MUS FJI CAF COD COG GIN DJI AUS PNG BRN BTN SLB TLS MWI SLE SOM SSD TCD SLV SUR TTO CAN USA CHN MLT"
export PUBLISHED_COUNTRIES="${published_countries}"
read -r -a published_country_codes <<<"${published_countries}"
if [[ "${#published_country_codes[@]}" -ne 97 ]]; then
  echo "Public governance validation must cover exactly 97 jurisdictions" >&2
  exit 70
fi
curl_common=(
  --disable
  --connect-timeout 10
  --fail
  --max-filesize 4194304
  --max-time 30
  --noproxy '*'
  --proto '=https'
  --retry 2
  --show-error
  --silent
)

curl "${curl_common[@]}" \
  "${public_origin}/api/health/ready" |
  node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.status !== "ok" || body.version !== process.env.release_id) {
        throw new Error(`Unexpected public health payload: ${JSON.stringify(body)}`);
      }
    });
  '

curl "${curl_common[@]}" \
  "${public_origin}/api/countries" |
  node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const countries = Array.isArray(body.countries) ? body.countries : [];
      const expected = process.env.PUBLISHED_COUNTRIES.trim().split(/\s+/u);
      const byIso3 = new Map(countries.map((country) => [country.iso3, country]));
      if (body.status !== "ok" || countries.length !== 178 || byIso3.size !== 178) {
        throw new Error(`Expected 178 unique public countries, received ${countries.length}/${byIso3.size}`);
      }
      const incomplete = expected.filter(
        (iso3) => byIso3.get(iso3)?.dataCoverageStatus !== "covered",
      );
      if (incomplete.length > 0) {
        throw new Error(`Pending countries not publicly covered: ${incomplete.join(",")}`);
      }
    });
  '

assert_http_200() {
  request_url="$1"
  response_status="$(curl "${curl_common[@]}" --output /dev/null \
    --write-out '%{http_code}' "${request_url}")"
  test "${response_status}" = "200"
}

assert_http_200 "${public_origin}/"
assert_http_200 "${public_origin}/chat"
for iso3 in "${published_country_codes[@]}"; do
  assert_http_200 "${public_origin}/countries/${iso3}"
  curl "${curl_common[@]}" \
    "${public_origin}/api/countries/${iso3}?asOf=2026-08-11" |
    COUNTRY_ISO3="${iso3}" node -e '
      const chunks = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          body.status !== "available" ||
          body.asOf !== "2026-08-11" ||
          body.country?.iso3 !== process.env.COUNTRY_ISO3 ||
          body.country?.dataCoverageStatus !== "covered"
        ) {
          throw new Error(`Unexpected ${process.env.COUNTRY_ISO3} public detail payload`);
        }
      });
    '
done

assert_country_detail() {
  iso3="$1"
  expected_regulations="$2"
  required_source_fragment="$3"
  expected_effective_from="${4:-}"
  expected_source_published_on="${5:-}"
  expected_jurisdiction_code="${6:-}"
  expected_jurisdiction_source_id="${7:-}"
  expected_membership_source_id="${8:-}"
  curl "${curl_common[@]}" \
    "${public_origin}/api/countries/${iso3}?asOf=2026-08-11" |
    COUNTRY_ISO3="${iso3}" \
    EXPECTED_REGULATIONS="${expected_regulations}" \
    REQUIRED_SOURCE_FRAGMENT="${required_source_fragment}" \
    EXPECTED_EFFECTIVE_FROM="${expected_effective_from}" \
    EXPECTED_SOURCE_PUBLISHED_ON="${expected_source_published_on}" \
    EXPECTED_JURISDICTION_CODE="${expected_jurisdiction_code}" \
    EXPECTED_JURISDICTION_SOURCE_ID="${expected_jurisdiction_source_id}" \
    EXPECTED_MEMBERSHIP_SOURCE_ID="${expected_membership_source_id}" \
    node -e '
      const chunks = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const country = body.country;
        const expectedCount = Number(process.env.EXPECTED_REGULATIONS);
        const requiredSource = process.env.REQUIRED_SOURCE_FRAGMENT;
        const expectedEffectiveFrom = process.env.EXPECTED_EFFECTIVE_FROM;
        const expectedSourcePublishedOn = process.env.EXPECTED_SOURCE_PUBLISHED_ON;
        const expectedJurisdictionCode = process.env.EXPECTED_JURISDICTION_CODE;
        const expectedJurisdictionSourceId = process.env.EXPECTED_JURISDICTION_SOURCE_ID;
        const expectedMembershipSourceId = process.env.EXPECTED_MEMBERSHIP_SOURCE_ID;
        if (
          body.status !== "available" ||
          country?.iso3 !== process.env.COUNTRY_ISO3 ||
          country?.dataCoverageStatus !== "covered" ||
          country.currentEffectiveRegulations.length !== expectedCount
        ) {
          throw new Error(`Unexpected ${process.env.COUNTRY_ISO3} public detail payload`);
        }
        if (expectedJurisdictionCode) {
          const matchingJurisdictions = country.jurisdictions.filter(
            (jurisdiction) => jurisdiction.code === expectedJurisdictionCode,
          );
          const jurisdiction = matchingJurisdictions[0];
          if (
            matchingJurisdictions.length !== 1 ||
            jurisdiction.type !== "country" ||
            jurisdiction.source.id !== expectedJurisdictionSourceId ||
            jurisdiction.membershipSource.id !== expectedMembershipSourceId
          ) {
            throw new Error(`Unexpected ${process.env.COUNTRY_ISO3} national source graph`);
          }
        }
        if (
          requiredSource &&
          !country.sources.some((source) => source.title.includes(requiredSource))
        ) {
          throw new Error(`Missing ${process.env.COUNTRY_ISO3} accepted source: ${requiredSource}`);
        }
        if (
          expectedEffectiveFrom &&
          !country.currentEffectiveRegulations.some(
            (regulation) => regulation.effectiveFrom === expectedEffectiveFrom,
          )
        ) {
          throw new Error(`Unexpected ${process.env.COUNTRY_ISO3} regulation effective date`);
        }
        if (
          expectedSourcePublishedOn &&
          !country.sources.some(
            (source) =>
              source.title.includes(requiredSource) &&
              source.publishedOn === expectedSourcePublishedOn,
          )
        ) {
          throw new Error(`Unexpected ${process.env.COUNTRY_ISO3} source publication date`);
        }
      });
    '
}

# 代表性语义：退役 numeric 图归零、metadata-only 法规保留、LIE/SGP 图补齐、
# URY 仅刷新 V5 source 日期，以及七批 source-only 国家继续失败关闭。
assert_country_detail DZA 0 "" "" "" DZ-NATIONAL 10000000-0000-4000-8000-000000000543 10000000-0000-4000-8000-000000000544
assert_country_detail ETH 0 "" "" "" ET-NATIONAL 10000000-0000-4000-8000-000000000551 10000000-0000-4000-8000-000000000552
assert_country_detail NGA 0 "" "" "" NG-NATIONAL 10000000-0000-4000-8000-000000000722 10000000-0000-4000-8000-000000000400
assert_country_detail UGA 1 "Air Quality Standards" "" "" UG-NATIONAL 10000000-0000-4000-8000-000000000573 10000000-0000-4000-8000-000000000574
assert_country_detail LIE 2 "LGBl. 1996 Nr. 143" "" "" LI-NATIONAL 10000000-0000-4000-8000-000000000282 10000000-0000-4000-8000-000000000282
assert_country_detail SGP 2 "S 480/2017" "" "" SG-NEA 10000000-0000-4000-8000-000000000275 10000000-0000-4000-8000-000000000274
assert_country_detail LKA 1 "Gazette" "" "" LK-NATIONAL 10000000-0000-4000-8000-000000000529 10000000-0000-4000-8000-000000000530
assert_country_detail URY 1 "Vehicle-emission homologation procedure V5" 2023-05-14 2025-11-13 UY-NATIONAL 10000000-0000-4000-8000-000000000561 10000000-0000-4000-8000-000000000562
assert_country_detail GUY 0 "Environmental Protection (Air Quality) Regulations" "" "" GY-NATIONAL 10000000-0000-4000-8000-000000000648 10000000-0000-4000-8000-000000000649
assert_country_detail GMB 0 "Environmental Quality Standards" "" "" GM-NATIONAL 10000000-0000-4000-8000-000000000640 10000000-0000-4000-8000-000000000641
assert_country_detail DJI 0 "Code de la Route" "" "" DJ-NATIONAL 10000000-0000-4000-8000-000000000632 10000000-0000-4000-8000-000000000633
assert_country_detail AUS 1 "Vehicle Standard (Australian Design Rule 80/04" 2025-11-01
assert_country_detail PNG 1 "Road Traffic Rules"
assert_country_detail CAN 2 "On-Road Vehicle and Engine Emission Regulations"
assert_country_detail USA 2 "40 CFR § 1036.104"
assert_country_detail CHN 3 "GB 20891-2014" "" "" CN-MEE 10000000-0000-4000-8000-000000000732 10000000-0000-4000-8000-000000000201
assert_country_detail MLT 2 "EU countries: official country profiles and accession dates"
assert_country_detail BRN 0 "Road Traffic Regulations (Chapter 68)"
assert_country_detail BTN 0 "Environmental Standards, 2020"
assert_country_detail SLB 0 "Road Transport Act (Cap. 131)"
assert_country_detail TLS 0 "Lei de Bases do Ambiente"
assert_country_detail MWI 0 "Road Traffic Act"
assert_country_detail SLE 0 "The Environment Protection Agency Act, 2022"
assert_country_detail SOM 0 "Environmental Protection and Management Act"
assert_country_detail SSD 0 "National Bureau of Standards Act, 2012"
assert_country_detail TCD 0 "Décret n° 904/PR/PM/MERH/2009"
assert_country_detail SLV 0 "Acuerdo No. 126"
assert_country_detail SUR 0 "Milieu Raamwet"
assert_country_detail TTO 0 "The Air Pollution Rules, 2014"
}

validate_public_governance "$1"
