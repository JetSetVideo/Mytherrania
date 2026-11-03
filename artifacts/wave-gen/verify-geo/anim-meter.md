Q1 independent animation meter (tools/verify-wave-gen-geo.ts anim): own driver (Animator -> Skeleton.drive -> rig.update ->
placement -> settleOnFloor when groundBody), own meters on EVERY skin vertex (CPU skinned via SkinnedMesh.getVertexPosition):
floorMm = min skin vertex y; slideMm = drift of the centroid of the 12 lowest foot-bone vertices while the Animator reports
the foot planted; popMm = largest per-frame skin-vertex displacement after removing the root's own translation;
popBoneRad = largest per-frame local-quaternion change of any bone. No arm guard / swing (idle, walk, strafe, fall:back only).
