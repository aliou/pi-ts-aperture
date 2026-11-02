import type { Api } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import {
  type ApiUpstreams,
  buildStreamSimple as buildStreamSimpleWith,
  buildStream as buildStreamWith,
} from "../../src/api-routing";

/**
 * Compat-fed upstream resolver: dispatches to the API implementation the
 * coding agent registered for `api`. pi's extension loader resolves pi-ai
 * through jiti aliases that prefix-match the bare package specifier, so the
 * compat registry (an exact alias) is the only thing `extensions/` may use.
 */
export const compatUpstreams: ApiUpstreams = (api: Api) => getApiProvider(api);

/** Stream by dispatching to the upstream Pi API the model routes through. */
export function buildStreamSimple() {
  return buildStreamSimpleWith(compatUpstreams);
}

/** Full-stream counterpart of buildStreamSimple. */
export function buildStream() {
  return buildStreamWith(compatUpstreams);
}
