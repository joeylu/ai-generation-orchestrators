# Foreground and camera review

An independent world-space foreground object may be cropped by the reference
frame while its bottom becomes visible when the camera moves. Background-band
coverage does not establish foreground support. Treat a world foreground and a
viewport-fixed frame decoration as different design responsibilities; do not
silently convert existing world sprites to screen space.

`reviewForegroundBottom` is a zero-generation, bounds-only diagnostic. Supply
an independently measured world-space envelope, a rectangular finite camera
center domain, world viewport size, reference center, actual layer parallax,
and the editor and/or Play modes to inspect. It reports whether the envelope's
bottom can enter the union of the corresponding views. Editor ignores parallax;
Play uses the same projection as the Studio. The inputs and output do not alter
the document, camera or original pixels.

An exposed envelope is a review prompt, not proof of visible pixels or a
defect. A hidden envelope does not establish continuous support, occlusion,
coverage at other zooms, or art acceptance. Review actual source alpha, nearby
support and representative Studio views separately. A scrolling foreground
needs an independently designed support/continuation where appropriate; this
diagnostic does not create or repair one.
