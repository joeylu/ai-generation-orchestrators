# Background band layout feasibility prototype

`bandLayoutFeasibility` is an independent, opt-in geometry helper; it is not
wired to planning, generation, quality review or delivery. It tests whether one
uniform positive scale and x/y translation can simultaneously cover a supplied
world rectangle with the entire native image frame and place all explicitly
observed feature intervals inside their desired world intervals. Feature native
coordinates are `[min,max]` fractions of the entire native image width/height;
target coordinates, coverage rectangle and translation ranges use the same
caller-selected world units. Source size is native pixels, and scale converts
native pixels to those world units. Both endpoints of each uncertain feature
must lie within the target interval. No assumption is made about the actual
content between endpoints.

The caller must derive the coverage rectangle from the frozen finite camera
contract and actual layer/parallax mode, choose bounded scale/translation ranges,
and document the provenance and uncertainty of observed feature intervals. A
feasible result includes one shared-scale witness and the permitted scale
interval. Infeasibility concerns only the supplied bounds, not all possible
artwork or camera choices. A tolerance is not added to manufacture feasibility.
Floating-point boundary cases should be independently checked at intended
precision.

The helper does not recognize images, measure landmarks, verify Alpha or painted
continuity, prove a guide or model will follow constraints, authorize compute,
or grant visual acceptance. Before generation, a source feature interval is a
design assumption; after generation it must be measured anew from the native
image. Callers must bind inputs and results into their own verified plan/evidence
format before treating them as a gate. Existing plans remain unchanged.
