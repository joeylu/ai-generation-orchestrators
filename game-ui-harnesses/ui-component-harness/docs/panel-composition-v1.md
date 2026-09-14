# Panel surface composition v1

Existing binding 0.2 Panel roles retain their names. background is required;
header and body are optional independent surfaces. states.panel.titleLayout
remains required. Runtime PanelRasterAppearance.header is optional like body.
Use only background for a complete empty frame. Do not duplicate its crops on top.
The title remains runtime text without header art. Missing optional art causes
no placeholder drawing. Malformed explicit parts and invalid resources still fail.
Legacy multi-part Panels remain supported. New header-free packages require this
consumer capability; older consumers may reject them. Panel has no intrinsic
ON/OFF or scroll state. Child controls require their own interaction acceptance.
Human visual acceptance remains false.
