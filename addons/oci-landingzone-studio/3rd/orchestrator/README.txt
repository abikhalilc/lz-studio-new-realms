Pinned upstream source archive: terraform-oci-modules-orchestrator v2.2.0
Source: https://github.com/oci-landing-zones/terraform-oci-modules-orchestrator/archive/refs/tags/v2.2.0.zip
SHA256: c53f5492ab6e61eda9f3aa80ec85983ff5e40bf78d0e8e4e00d830116f37af71
Original license/copyright notices are preserved inside the archive.

Studio applies explicit compatibility edits in src/export/resourceManagerTemplate.ts
when creating a per-design Resource Manager template. The upstream ZIP is not
modified. The generated template is a Studio compatibility package, not an
unmodified upstream release. Module and provider versions remain those selected
by upstream; actual cloud provisioning must still be reviewed and validated.

Compatibility changes:
- Empty external Vault dependencies are normalized to null (Security 0.2.3
  otherwise attempts to look up a new managed Vault as an external Vault).
- An explicit deployment phase selects the design's exact phase file list.
- Missing configuration bucket/CLI inputs fail planning rather than yielding
  an apparently successful output-only plan.
- The template contains no private key, credentials or generated customer JSON.
