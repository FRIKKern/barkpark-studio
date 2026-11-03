# PortableDoc conformance pack

Synced from `FRIKKern/barkpark` commit `96cce88b565ccea8c82d49110503bd046ea7e0b6`.

The checked-in pack is intentional: CI must exercise this host renderer against
the same pinned inputs and normalizer that produced the committed report. Update
`conformance.mjs`, `goldens/stamp.json`, and `goldens/blocks/*.golden.json`
together when advancing the pin.
