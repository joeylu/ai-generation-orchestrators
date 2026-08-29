# Golden fixture provenance

`matte-cases.json` contains minimal public reconstructions of production failures:

- an enclosed key-colour island inside a wide ribbon loop, which must be removed
  globally rather than retained by edge-connected flood fill;
- frame-to-frame background colour drift, which must be calibrated per frame;
- wide key-colour blends at antialiased edges, which must produce soft alpha and
  then be decontaminated.

Provenance is `synthetic_reproduction`. The private v06 ribbon dancer, v07 loop,
and v08 one-shot samples located during the audit remain candidate evidence only;
they are not redistributable accepted goldens until foreground/background and
continuity labels are explicitly approved.
