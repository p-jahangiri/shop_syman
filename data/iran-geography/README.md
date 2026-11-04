# Iran address geography data (standalone aggregate)

Pinned upstream: [sajaddp/list-of-cities-in-Iran](https://github.com/sajaddp/list-of-cities-in-Iran), commit recorded in upstream-commit.txt, release 3.1.2. The source reports administrative divisions through the end of 1404. This is a community projection of a government workbook, not an official live government service.

Original provinces/counties/cities JSONs and manifest are retained unmodified under the included GPL-3.0 LICENSE. The independently generated public projection uses decimal-string IDs and explicit parent links. All 31 provinces, 484 counties and 1672 city records (including 191 urban-zone records in the source) are kept. No upstream executable code is included. The data is a standalone aggregate with its own license; application code is separate.

Public projection and license: `apps/storefront/public/data/iran-geography.v1.json`, `iran-geography-LICENSE.txt`, `iran-geography-source.json`. Corresponding original data and upstream source are linked in the source metadata. Changes to this data projection remain GPL-3.0. Rebuild with `python3 scripts/build-address-geography.py` and run the geography integrity tests after updating the pinned inputs. Do not silently remove or re-parent IDs during updates.

County map centers are optional GeoNames enrichment, CC BY 4.0, with attribution on the map. They are administrative seats, not borders, geocoding or proof of a destination. The map marker is only selected by the customer.

Completeness is relative to this dated dataset. Manual locality entry remains available within a known province/county for villages and newly created places. It is explicitly unverified. Postal/mobile format checks do not verify postal delivery, ownership or identity.

A future version update must retain a reader/registry for geography versions already stored inside encrypted address payloads, or perform an explicit, tested migration. Do not replace the only resource and bump the version constant while making existing saved addresses unreadable. Legacy data without `details` remains readable independently.
