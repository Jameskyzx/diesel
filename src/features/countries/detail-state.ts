import type {
  CountryApiErrorCode,
  CountryDetailResponse,
} from "@/features/countries/schemas";
import type { ApplicationScope } from "@/features/database/schemas";

export type CountryDetailQueryIdentity = {
  iso3: string;
  applicationScope: ApplicationScope | null;
  powerKw: number | null;
  asOf: string | null;
};

export type CountryDetailState =
  | { status: "idle" }
  | {
      query: CountryDetailQueryIdentity;
      response: CountryDetailResponse;
      status: "ready";
    }
  | {
      code: CountryApiErrorCode | null;
      query: CountryDetailQueryIdentity;
      status: "error";
    };

export type CurrentCountryDetailState =
  | CountryDetailState
  | { iso3: string; status: "loading" };

/** Select already-validated render inputs without caching an older SSR value. */
export function selectCountryDetailState({
  query,
  initialResponse,
  detail,
}: {
  query: CountryDetailQueryIdentity | null;
  initialResponse?: CountryDetailResponse;
  detail: CountryDetailState;
}): CurrentCountryDetailState {
  if (query === null) {
    return { status: "idle" };
  }
  if (initialResponse !== undefined) {
    return { query, response: initialResponse, status: "ready" };
  }

  if (
    detail.status !== "idle" &&
    detail.query.iso3 === query.iso3 &&
    detail.query.applicationScope === query.applicationScope &&
    detail.query.powerKw === query.powerKw
  ) {
    if (detail.query.asOf === query.asOf) {
      return detail;
    }
    // Writing the server-resolved default date into the URL is equivalent
    // only for an available response to the same country/scope/power query.
    // Errors and no-data responses do not establish that resolved date.
    if (
      detail.status === "ready" &&
      detail.query.asOf === null &&
      query.asOf !== null &&
      detail.response.status === "available" &&
      detail.response.asOf === query.asOf
    ) {
      return detail;
    }
  }

  return { iso3: query.iso3, status: "loading" };
}
