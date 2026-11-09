import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import upstreamUrl from '../../3rd/orchestrator/upstream-v2.2.0.zip?url';
import { completionNetwork, dependencyFiles, deploymentReadme, ORCHESTRATOR_VERSION } from '../services/deployment';
import { deploymentStages } from '../generator/outputNames';
import type { LzConfig } from '../services/lzConfig';

export const TEMPLATE_FILENAME = 'resource-manager-template.zip';
const root = `terraform-oci-modules-orchestrator-${ORCHESTRATOR_VERSION.slice(1)}/`;
const facade = `${root}rms-facade/`;

// JSON strings are also HCL literals after escaping HCL interpolation markers.
function hclLiteral(value: unknown): string {
  return JSON.stringify(value).replaceAll('${', () => '$${').replaceAll('%{', () => '%%{');
}

/** Keep compatibility changes explicit and fail on upstream source drift. */
function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error('The deployment template does not match the verified Orchestrator version.');
  return source.replace(before, () => after);
}

export function buildResourceManagerTemplate(config: LzConfig, files: string[], upstream: Uint8Array): Uint8Array {
  const entries = unzipSync(upstream);
  const [phase1, phase2] = deploymentStages(files, completionNetwork(config));
  const edit = (path: string, fn: (text: string) => string) => {
    if (!entries[path]) throw new Error(`Deployment template is missing ${path}.`);
    entries[path] = strToU8(fn(strFromU8(entries[path])));
  };
  edit(`${root}security.tf`, (text) => replaceOnce(text,
    'vaults_dependency       = local.ext_dep_vaults_security_map',
    'vaults_dependency       = length(local.ext_dep_vaults_security_map) > 0 ? local.ext_dep_vaults_security_map : null'));
  edit(`${facade}variables.tf`, (text) => replaceOnce(replaceOnce(text,
    'variable "configuration_source" {\n  type        = string\n  default     = "url"',
    'variable "configuration_source" {\n  type        = string\n  default     = "ocibucket"'),
    'variable "region" {\n  type    = string\n  default = null\n}',
    `variable "region" {\n  type    = string\n  default = ${hclLiteral(config.region)}\n}`));
  edit(`${facade}get_configurations.tf`, (text) => {
    if (!text.includes('var.oci_configuration_objects')) throw new Error('Missing configuration file loader.');
    return text.replaceAll('var.oci_configuration_objects', 'local.studio_configuration_objects');
  });
  edit(`${facade}get_dependencies.tf`, (text) => text.replaceAll('var.oci_dependency_objects', 'local.studio_dependency_objects'));
  edit(`${facade}schema.yml`, (text) => {
    const start = text.indexOf('  oci_configuration_objects:\n');
    const end = text.indexOf('  oci_dependency_objects:\n', start);
    if (start < 0 || end < 0) throw new Error('Missing configuration file form.');
    return text.slice(0, start) + `  studio_deployment_phase:
    type: enum
    title: "Deployment phase"
    description: "Use phase1 for the first deployment. After its Apply succeeds, select phase2 in the same stack. File selection is automatic."
    default: phase1
    enum:
      - phase1
      - phase2

  oci_configuration_objects:
    type: array
    items:
      type: string
    visible: false

` + text.slice(end);
  });
  edit(`${facade}schema.yml`, (text) => replaceOnce(replaceOnce(text, '      - oci_configuration_objects\n', '      - studio_deployment_phase\n'), '  configuration_source:\n', '  configuration_source:\n    default: ocibucket\n'));
  edit(`${facade}schema.yml`, (text) => {
    const start = text.indexOf('  oci_dependency_objects:\n');
    const end = text.indexOf('  github_token:\n', start);
    if (start < 0 || end < 0) throw new Error('Missing dependency file form.');
    return text.slice(0, start) + '  oci_dependency_objects:\n    type: array\n    items:\n      type: string\n    visible: false\n\n' + text.slice(end);
  });
  entries[`${facade}studio_deployment.tf`] = strToU8(`variable "studio_deployment_phase" {
  type = string
  default = "phase1"
  validation {
    condition = contains(["phase1", "phase2"], var.studio_deployment_phase)
    error_message = "Choose phase1 or phase2."
  }
}
locals {
  studio_phase_files = {
    phase1 = ${hclLiteral(phase1.files)}
    phase2 = ${hclLiteral(phase2.files)}
  }
  studio_configuration_objects = local.studio_phase_files[var.studio_deployment_phase]
  studio_dependency_objects = ${hclLiteral(dependencyFiles(config))}
}
output "studio_deployment_phase" {
  value = var.studio_deployment_phase
  precondition {
    condition = var.configuration_source == "ocibucket" ? try(length(trimspace(var.oci_configuration_bucket)) > 0, false) : var.configuration_source == "file" ? length(var.local_config_file_paths) > 0 : false
    error_message = "Choose ocibucket and enter the private configuration bucket name, or file with local configuration paths. An empty deployment is not allowed."
  }
}
`);
  entries[`${facade}STUDIO-COMPATIBILITY.txt`] = strToU8(`Studio deployment template based on Orchestrator ${ORCHESTRATOR_VERSION}.
Changes: automatic per-design phase file lists; required bucket/input guard; empty external Vault dependencies normalized to null.
Original provider and module versions are retained. This is a Studio compatibility package, not an unmodified upstream release.
`);
  return zipSync(entries, { level: 6 });
}

let upstreamBytes: Promise<Uint8Array> | undefined;
export function loadTemplateSource(): Promise<Uint8Array> {
  upstreamBytes ??= fetch(upstreamUrl).then(async (response) => {
    if (!response.ok) throw new Error('Could not load the deployment template. Download again when Studio is reachable.');
    return new Uint8Array(await response.arrayBuffer());
  }).catch((error: unknown) => { upstreamBytes = undefined; throw error; });
  return upstreamBytes;
}

export async function deploymentBundle(config: LzConfig, files: Record<string, string>, source: string): Promise<Record<string, string | Uint8Array>> {
  return {
    'config.jsonnet': source, ...files,
    [TEMPLATE_FILENAME]: buildResourceManagerTemplate(config, Object.keys(files), await loadTemplateSource()),
    'README.txt': deploymentReadme(config, Object.keys(files)),
  };
}
