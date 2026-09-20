"use client";

import type {
  FillLayerSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
  MapSourceDataEvent,
  StyleSpecification,
} from "maplibre-gl";
import {
  AttributionControl,
  GPUInitializationError,
  Map as MapLibreMapClass,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react";

import { useLocale } from "@/components/i18n/locale-provider";
import {
  countryGeoFeaturePropertiesSchema,
  type CountryDirectory,
  type CountryMapSummary,
} from "@/features/countries/schemas";
import { countryDirectoryDisplayIdentity } from "@/features/countries/directory-display";
import { hasDetailedCountryCoverage } from "@/features/database/schemas";
import { WORLD_COUNTRIES_GEOJSON_URL } from "@/lib/geo-assets";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibre-assets";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { formatUtcDate } from "@/i18n/date";

const COUNTRY_SOURCE = "world-countries";
const COUNTRY_FILL_LAYER = "country-fill";
const COUNTRY_LINE_LAYER = "country-lines";
const TOOLTIP_EDGE_PADDING = 8;
const TOOLTIP_ESTIMATED_HEIGHT = 128;
const TOOLTIP_MIN_TOP = 64;
const TOOLTIP_WIDTH = 224;

// Serve the ESM worker and its relative shared module together. Next's URL
// asset pipeline does not emit the shared sibling of MapLibre's worker.
setWorkerUrl(MAPLIBRE_WORKER_URL);

const mapStyle: StyleSpecification = {
  layers: [
    {
      id: "background",
      paint: {
        "background-color": "#e9f2f3",
      },
      type: "background",
    },
  ],
  projection: {
    type: "mercator",
  },
  sources: {},
  version: 8,
};

const countryFillLayer: FillLayerSpecification = {
  id: COUNTRY_FILL_LAYER,
  paint: {
    "fill-color": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      "#f59e0b",
      ["boolean", ["feature-state", "hover"], false],
      "#4d9e82",
      ["boolean", ["feature-state", "hasData"], false],
      "#167260",
      "#cbd8dc",
    ],
    "fill-opacity": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      0.95,
      ["boolean", ["feature-state", "hover"], false],
      0.9,
      ["boolean", ["feature-state", "hasData"], false],
      0.82,
      0.72,
    ],
  },
  source: COUNTRY_SOURCE,
  type: "fill",
};

const countryLineLayer: LineLayerSpecification = {
  id: COUNTRY_LINE_LAYER,
  paint: {
    "line-color": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      "#92400e",
      ["boolean", ["feature-state", "hover"], false],
      "#135f50",
      "#ffffff",
    ],
    "line-opacity": 0.95,
    "line-width": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      2.2,
      ["boolean", ["feature-state", "hover"], false],
      1.6,
      0.65,
    ],
  },
  source: COUNTRY_SOURCE,
  type: "line",
};

type TooltipState = {
  containerHeight: number;
  containerWidth: number;
  iso3: string;
  name: string;
  summary: CountryMapSummary | null;
  x: number;
  y: number;
};

type WorldMapProps = {
  countries: CountryMapSummary[];
  countryIndex: CountryDirectory;
  onSelectCountry: (iso3: string) => void;
  selectedIso3: string | null;
};

function tooltipCoverageText(
  summary: CountryMapSummary | null,
  copy: Dictionary["map"],
): string {
  if (!summary) {
    return copy.tooltipNoData;
  }
  if (!hasDetailedCountryCoverage(summary.dataCoverageStatus)) {
    return summary.dataCoverageStatus === "planned"
      ? copy.tooltipPlanned
      : copy.tooltipNoData;
  }
  return summary.isDemo ? copy.tooltipDemo : copy.tooltipVerified;
}

function setCountryState(
  map: MapLibreMap,
  iso3: string,
  state: Readonly<Record<string, boolean>>,
) {
  map.setFeatureState(
    {
      id: iso3,
      source: COUNTRY_SOURCE,
    },
    state,
  );
}

export function WorldMap({
  countries,
  countryIndex,
  onSelectCountry,
  selectedIso3,
}: WorldMapProps) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.map;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(selectedIso3);
  const onSelectRef = useRef(onSelectCountry);
  const [loadState, setLoadState] = useState<
    "error" | "gpu-error" | "loading" | "ready"
  >("loading");
  const [retryKey, setRetryKey] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const countriesByIso3 = useMemo(
    () => new Map(countries.map((country) => [country.iso3, country])),
    [countries],
  );
  const countryDirectoryByIso3 = useMemo(
    () => new Map(countryIndex.map((country) => [country.iso3, country])),
    [countryIndex],
  );

  useEffect(() => {
    onSelectRef.current = onSelectCountry;
  }, [onSelectCountry]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let disposed = false;
    let failed = false;
    // Deliver external renderer state after effect setup, with this instance
    // as owner so an obsolete initialization cannot update the next map.
    queueMicrotask(() => {
      if (disposed || failed) return;
      setLoadState("loading");
      setTooltip(null);
    });
    hoveredRef.current = null;
    let map: MapLibreMap;
    try {
      map = new MapLibreMapClass({
        attributionControl: false,
        center: [8, 18],
        container,
        maxZoom: 6,
        minZoom: 0.8,
        locale: {
          "AttributionControl.ToggleAttribution": copy.toggleAttribution,
          "Map.Title": copy.mapCanvasAria,
          "NavigationControl.ZoomIn": copy.zoomIn,
          "NavigationControl.ZoomOut": copy.zoomOut,
        },
        renderWorldCopies: false,
        style: mapStyle,
        zoom: 1.15,
      });
    } catch (error: unknown) {
      if (!(error instanceof GPUInitializationError)) throw error;
      // The pinned v6.9 constructor rolls its container back before throwing,
      // before registering throttle/handlers/workers. There is no Map to remove.
      failed = true;
      queueMicrotask(() => {
        if (disposed) return;
        setTooltip(null);
        setLoadState("gpu-error");
      });
      return () => { disposed = true; };
    }
    mapRef.current = map;
    const canvas = map.getCanvas();
    let sourceReady = false;
    let firstRenderReady = false;
    const loadTimeout = setTimeout(() => {
      if (!firstRenderReady) {
        failMap("error");
      }
    }, 15_000);

    function disposeMap() {
      if (disposed) return;
      disposed = true;
      clearTimeout(loadTimeout);
      if (mapRef.current === map) mapRef.current = null;
      hoveredRef.current = null;
      canvas.removeEventListener("webglcontextlost", handleNativeContextLoss, true);
      map.remove();
    }

    function handleNativeContextLoss() {
      if (disposed || failed) return;
      failed = true;
      setTooltip(null);
      setLoadState("gpu-error");
      // We discard lost contexts rather than restore the old Map. Capture runs
      // before v6.9's bubble listener, whose Style.destroy() drops the style
      // before normal remove() can release its worker state and RTL listener.
      // Public remove() also detaches that bubble listener. Do not cancel or
      // synthesize the native event, or access any private MapLibre fields.
      disposeMap();
    }

    function failMap(reason: "error" | "gpu-error") {
      if (disposed || failed) return;
      failed = true;
      clearTimeout(loadTimeout);
      setTooltip(null);
      setLoadState(reason);
      // Finish the current MapLibre event dispatch before releasing the Map.
      // Cleanup/unmount may win this race; disposal remains idempotent.
      queueMicrotask(disposeMap);
    }

    const clearHoveredCountry = () => {
      if (disposed || failed) return;
      if (hoveredRef.current) {
        setCountryState(map, hoveredRef.current, { hover: false });
      }
      hoveredRef.current = null;
      setTooltip(null);
      map.getCanvas().style.cursor = "";
    };

    const handlePointerMove = (event: MapMouseEvent) => {
      if (disposed || failed) return;
      const [feature] = map.queryRenderedFeatures(event.point, {
        layers: [COUNTRY_FILL_LAYER],
      });
      const parsed = countryGeoFeaturePropertiesSchema.safeParse(
        feature?.properties,
      );
      if (!parsed.success) {
        clearHoveredCountry();
        return;
      }

      const { ISO3: iso3, name } = parsed.data;
      if (hoveredRef.current && hoveredRef.current !== iso3) {
        setCountryState(map, hoveredRef.current, { hover: false });
      }

      hoveredRef.current = iso3;
      setCountryState(map, iso3, { hover: true });
      map.getCanvas().style.cursor = "pointer";
      setTooltip({
        containerHeight: container.clientHeight,
        containerWidth: container.clientWidth,
        iso3,
        name,
        summary: countriesByIso3.get(iso3) ?? null,
        x: event.point.x,
        y: event.point.y,
      });
    };

    const handleCountryClick = (event: MapLayerMouseEvent) => {
      if (disposed || failed) return;
      const parsed = countryGeoFeaturePropertiesSchema.safeParse(
        event.features?.[0]?.properties,
      );
      if (parsed.success) {
        onSelectRef.current(parsed.data.ISO3);
      }
    };

    const handleSourceData = (event: MapSourceDataEvent) => {
      if (disposed || failed) return;
      if (
        event.sourceId === COUNTRY_SOURCE &&
        map.isSourceLoaded(COUNTRY_SOURCE)
      ) {
        if (map.querySourceFeatures(COUNTRY_SOURCE).length === 0) {
          failMap("error");
          return;
        }
        sourceReady = true;
      }
    };

    const handleIdle = () => {
      if (disposed || failed || firstRenderReady || !sourceReady) return;
      // Source availability can precede the first complete frame. Report ready
      // only after the renderer has finished its pending tiles and transitions.
      firstRenderReady = true;
      clearTimeout(loadTimeout);
      setLoadState("ready");
    };

    const handleMapError = () => {
      failMap("error");
    };

    map.on("sourcedata", handleSourceData);
    map.on("idle", handleIdle);
    map.on("error", handleMapError);
    canvas.addEventListener("webglcontextlost", handleNativeContextLoss, true);
    try {
      map.addControl(
        new AttributionControl({
          compact: true,
          customAttribution:
            '<a href="https://www.naturalearthdata.com/" rel="noreferrer">Natural Earth</a>',
        }),
      );
      map.addControl(
        new NavigationControl({ showCompass: false }),
        "bottom-right",
      );
    } catch (error: unknown) {
      disposeMap();
      throw error;
    }
    map.on("load", () => {
      if (disposed || failed) return;
      map.addSource(COUNTRY_SOURCE, {
        data: WORLD_COUNTRIES_GEOJSON_URL,
        promoteId: "ISO3",
        type: "geojson",
      });
      map.addLayer(countryFillLayer);
      map.addLayer(countryLineLayer);

      for (const country of countries) {
        if (hasDetailedCountryCoverage(country.dataCoverageStatus)) {
          setCountryState(map, country.iso3, { hasData: true });
        }
      }
      if (selectedRef.current) {
        setCountryState(map, selectedRef.current, { selected: true });
      }

      map.on("mousemove", handlePointerMove);
      map.on("mouseout", clearHoveredCountry);
      map.on("click", COUNTRY_FILL_LAYER, handleCountryClick);
    });

    return disposeMap;
  }, [copy, countries, countriesByIso3, retryKey]);

  useEffect(() => {
    const map = mapRef.current;
    const previouslySelected = selectedRef.current;
    selectedRef.current = selectedIso3;

    if (!map?.isStyleLoaded()) {
      return;
    }

    if (previouslySelected) {
      setCountryState(map, previouslySelected, { selected: false });
    }
    if (selectedIso3) {
      setCountryState(map, selectedIso3, { selected: true });
    }
    selectedRef.current = selectedIso3;
  }, [selectedIso3]);

  const tooltipDirectoryEntry = tooltip
    ? countryDirectoryByIso3.get(tooltip.iso3)
    : undefined;
  const tooltipDisplayIdentity = tooltip
    ? tooltipDirectoryEntry
      ? countryDirectoryDisplayIdentity(
          tooltipDirectoryEntry,
          tooltip.summary,
        )
      : (tooltip.summary ?? {
          isDemo: false,
          iso2: "",
          iso3: tooltip.iso3,
          nameEn: tooltip.name,
          nameLocal: null,
        })
    : null;

  return (
    <div
      aria-label={copy.interactiveAria}
      className="relative h-full min-h-[30rem] overflow-hidden rounded-[1.75rem] border border-black/[0.07] bg-[#e9f2f3] shadow-[0_28px_80px_rgb(29_56_47_/_0.12)]"
      data-testid="world-map"
      role="region"
    >
      <div
        className="!absolute inset-0 h-full w-full"
        data-map-ready={loadState === "ready"}
        data-testid="map-canvas-container"
        ref={containerRef}
      />
      {loadState === "loading" ? (
        <div
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-[#e9f2f3]/85 text-sm text-slate-600 backdrop-blur-sm"
          role="status"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 shadow-sm">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            {copy.geometryLoading}
          </span>
        </div>
      ) : null}
      {loadState === "error" || loadState === "gpu-error" ? (
        <div
          className="absolute inset-0 z-30 grid place-items-center bg-[#f7f4ed] p-6 text-center"
          role="alert"
        >
          <div className="max-w-sm">
            <AlertTriangle
              aria-hidden="true"
              className="mx-auto size-8 text-amber-700"
            />
            <p className="mt-3 font-semibold text-slate-950">
              {loadState === "gpu-error" ? copy.gpuErrorTitle : copy.boundaryErrorTitle}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {loadState === "gpu-error" ? copy.gpuErrorBody : copy.boundaryErrorBody}
            </p>
            <button
              className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-[#17382e] hover:bg-emerald-50"
              onClick={() => setRetryKey((key) => key + 1)}
              type="button"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              {copy.retryMap}
            </button>
          </div>
        </div>
      ) : null}
      {loadState === "ready" ? (
        <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap gap-2 text-xs sm:left-5 sm:top-5">
          <span className="rounded-full border border-emerald-900/10 bg-[#173d31]/95 px-3.5 py-2 font-medium text-white shadow-sm backdrop-blur">
            {copy.legendData}
          </span>
          <span className="rounded-full border border-black/[0.06] bg-white/90 px-3.5 py-2 font-medium text-slate-600 shadow-sm backdrop-blur">
            {copy.legendNoData}
          </span>
        </div>
      ) : null}
      {tooltip ? (
        <div
          className="pointer-events-none absolute z-20 w-56 rounded-2xl border border-black/[0.08] bg-[#fffefa]/95 p-4 shadow-[0_20px_50px_rgb(24_53_44_/_0.2)] backdrop-blur"
          data-country-iso3={tooltip.iso3}
          data-testid="map-tooltip"
          style={{
            left: Math.max(
              TOOLTIP_EDGE_PADDING,
              Math.min(
                tooltip.x + 14,
                Math.max(
                  TOOLTIP_EDGE_PADDING,
                  tooltip.containerWidth -
                    TOOLTIP_WIDTH -
                    TOOLTIP_EDGE_PADDING,
                ),
              ),
            ),
            top: Math.max(
              TOOLTIP_MIN_TOP,
              Math.min(
                tooltip.y - 32,
                Math.max(
                  TOOLTIP_MIN_TOP,
                  tooltip.containerHeight -
                    TOOLTIP_ESTIMATED_HEIGHT -
                    TOOLTIP_EDGE_PADDING,
                ),
              ),
            ),
          }}
        >
          <p className="display-title text-lg font-semibold text-[#17382e]">
            {tooltipDisplayIdentity
              ? formatCountryDisplayName(tooltipDisplayIdentity, locale)
              : tooltip.name}
          </p>
          <p className="mt-0.5 text-[10px] font-semibold tracking-[0.16em] text-emerald-700">
            {tooltip.iso3}
          </p>
          <p className="mt-2 text-xs">
            {tooltipCoverageText(tooltip.summary, copy)}
          </p>
          {tooltip.summary ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {copy.verification}{dictionary.common.labelSeparator}
              {formatUtcDate(tooltip.summary.verifiedAt, locale)}
              {tooltip.summary.isStale &&
              hasDetailedCountryCoverage(
                tooltip.summary.dataCoverageStatus,
              )
                ? copy.tooltipStale
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
