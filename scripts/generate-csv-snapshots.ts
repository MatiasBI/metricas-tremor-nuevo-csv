import { createReadStream } from "fs"
import { promises as fs } from "fs"
import path from "path"
import { Readable } from "stream"
import { parse } from "csv-parse"

type EstadoClave = "resueltos" | "pendientes" | "denegados"
type DatasetKey = "alumbrado" | "paisaje-urbano"

type NormalizedRow = {
  aviso: string | null
  fecha: string | null
  horaIngreso: string | null
  comuna: string | null
  barrio: string | null
  categoria: string | null
  prestacion: string | null
  grupoPlanificacion: string | null
  statusUsuario: string | null
  motivoDenegado: string | null
  estado: EstadoClave | null
  ultMes: string
}

type Snapshot = {
  rows: NormalizedRow[]
  filtros: {
    years: string[]
    prestaciones: string[]
    categorias: string[]
    comunas: string[]
    barrios: string[]
  }
}

type CsvRow = string[]

const DEFAULT_CSV_PATH =
  "C:\\Users\\Usuario\\Downloads\\avisos_20260507_154442.csv"

const CSV_PATH = process.env.METRICAS_CSV_PATH || DEFAULT_CSV_PATH
const CSV_URL = process.env.METRICAS_CSV_URL
const OUT_DIR = path.join(process.cwd(), "src", "data", "metricas-demo")
const DEFAULT_CSV_DELIMITER = "|"
const DEFAULT_CSV_FROM_LINE = 1

const VALID_COMUNAS = new Set(
  Array.from({ length: 15 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`)
)

const ALUMBRADO_PRESTACIONES = new Set([
  "COLUMNA DE ALUMBRADO: TAPA FALT Y/O DETE",
  "LUMINARIA: APAGADA",
  "LUMINARIA: ARTEFACTO ROTO Y/O FALTANTE",
  "LUMINARIA: ENCENDIDO INTERMITENTE",
  "LUMINARIA: ENCENDIDO PERMANENTE",
  "LUMINARIA: LIMPIEZA DE ARTEFACTO",
  "TOMA DE ENERGIA: FALTANTE O DETERIORADA",
  "LUMINARIA: REFUERZO DE ALUMBRADO PUBLICO",
])

const ALUMBRADO_GRUPOS_EXCLUIDOS = new Set(["ALU", "ALD"])

const PAISAJE_GRUPOS = new Set(["EV1", "OR1", "OR2"])

const STATUS_MAP: Record<string, EstadoClave> = {
  REOK: "resueltos",
  OPER: "pendientes",
  INIC: "pendientes",
  PLAN: "pendientes",
  VERI: "pendientes",
  PROG: "pendientes",
  FREN: "pendientes",
  SERV: "pendientes",
  IM01: "denegados",
  IM02: "denegados",
  IM03: "denegados",
  IM04: "denegados",
  IM05: "denegados",
  CANC: "denegados",
  TERC: "denegados",
  OTRA: "denegados",
}

const COLUMN = {
  comuna: 0,
  aviso: 2,
  barrio: 6,
  fechaAviso: 9,
  ubicacion: 11,
  descripcion: 12,
  prestacion: 16,
  grupoPlanificacion: 22,
  horaIngreso: 25,
  statusUsuario: 37,
  tipo: 39,
  observaciones: 40,
} as const

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function normalizeComuna(value: string) {
  const comuna = normalizeText(value).toUpperCase()
  return VALID_COMUNAS.has(comuna) ? comuna : null
}

function parseDate(value: string) {
  const raw = normalizeText(value)

  if (!/^\d{8}$/.test(raw)) {
    return null
  }

  const year = Number(raw.slice(0, 4))
  const month = Number(raw.slice(4, 6))
  const day = Number(raw.slice(6, 8))
  const parsed = new Date(Date.UTC(year, month - 1, day))

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseTime(value: string) {
  const raw = normalizeText(value).padStart(6, "0")

  if (!/^\d{6}$/.test(raw)) {
    return null
  }

  const hours = Number(raw.slice(0, 2))
  const minutes = Number(raw.slice(2, 4))
  const seconds = Number(raw.slice(4, 6))

  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function normalizeEstado(value: string) {
  return STATUS_MAP[normalizeText(value).toUpperCase()] ?? null
}

function normalizeStatusUsuario(value: string) {
  return normalizeText(value).toUpperCase() || null
}

function get(row: CsvRow, index: number) {
  return row[index] ?? ""
}

function isCoreRow(row: CsvRow) {
  return Boolean(
    normalizeComuna(get(row, COLUMN.comuna)) &&
      normalizeText(get(row, COLUMN.aviso)) &&
      parseDate(get(row, COLUMN.fechaAviso)) &&
      normalizeText(get(row, COLUMN.prestacion)) &&
      normalizeEstado(get(row, COLUMN.statusUsuario))
  )
}

function getDatasetKey(row: CsvRow): DatasetKey | null {
  const prestacion = normalizeText(get(row, COLUMN.prestacion))
  const grupo = normalizeText(get(row, COLUMN.grupoPlanificacion)).toUpperCase()

  if (
    (grupo.startsWith("AL") && !ALUMBRADO_GRUPOS_EXCLUIDOS.has(grupo)) ||
    ALUMBRADO_PRESTACIONES.has(prestacion)
  ) {
    return "alumbrado"
  }

  if (PAISAJE_GRUPOS.has(grupo)) {
    return "paisaje-urbano"
  }

  return null
}

function getCategoria(row: CsvRow, datasetKey: DatasetKey) {
  if (datasetKey === "alumbrado") {
    return normalizeText(get(row, COLUMN.prestacion)) || null
  }

  return normalizeText(get(row, COLUMN.tipo)) || null
}

function normalizeRow(row: CsvRow, datasetKey: DatasetKey): NormalizedRow {
  const fecha = parseDate(get(row, COLUMN.fechaAviso))
  const aviso = normalizeText(get(row, COLUMN.aviso))
  const prestacion = normalizeText(get(row, COLUMN.prestacion))
  const grupoPlanificacion = normalizeText(get(row, COLUMN.grupoPlanificacion)).toUpperCase()
  const statusUsuario = normalizeStatusUsuario(get(row, COLUMN.statusUsuario))
  const estado = normalizeEstado(get(row, COLUMN.statusUsuario))

  return {
    aviso: aviso || null,
    fecha,
    horaIngreso: parseTime(get(row, COLUMN.horaIngreso)),
    comuna: normalizeComuna(get(row, COLUMN.comuna)),
    barrio: normalizeText(get(row, COLUMN.barrio)) || null,
    categoria: getCategoria(row, datasetKey),
    prestacion: prestacion || null,
    grupoPlanificacion: grupoPlanificacion || null,
    statusUsuario,
    motivoDenegado: estado === "denegados" ? statusUsuario : null,
    estado,
    ultMes: "",
  }
}

function buildSnapshot(rows: NormalizedRow[]): Snapshot {
  const years = new Set<string>()
  const prestaciones = new Set<string>()
  const categorias = new Set<string>()
  const comunas = new Set<string>()
  const barrios = new Set<string>()

  for (const row of rows) {
    if (row.fecha) {
      years.add(String(new Date(row.fecha).getUTCFullYear()))
    }
    if (row.prestacion) prestaciones.add(row.prestacion)
    if (row.categoria) categorias.add(row.categoria)
    if (row.comuna) comunas.add(row.comuna)
    if (row.barrio) barrios.add(row.barrio)
  }

  return {
    rows,
    filtros: {
      years: Array.from(years).sort(),
      prestaciones: Array.from(prestaciones).sort(),
      categorias: Array.from(categorias).sort(),
      comunas: Array.from(comunas).sort(),
      barrios: Array.from(barrios).sort(),
    },
  }
}

async function createInputStream() {
  if (!CSV_URL) {
    return createReadStream(CSV_PATH)
  }

  const response = await fetchDownloadResponse(CSV_URL)

  if (!response.ok || !response.body) {
    throw new Error(`No se pudo descargar el CSV: ${response.status}`)
  }

  const contentType = response.headers.get("content-type") ?? ""

  if (contentType.includes("text/html")) {
    throw new Error(
      "La URL configurada devolvio HTML. Usa un link directo al CSV crudo diario."
    )
  }

  return Readable.fromWeb(response.body as import("stream/web").ReadableStream)
}

async function fetchDownloadResponse(url: string) {
  const response = await fetch(resolveDownloadUrl(url))
  const contentType = response.headers.get("content-type") ?? ""

  if (!isGoogleDriveUrl(url) || !contentType.includes("text/html")) {
    return response
  }

  const html = await response.text()
  const confirmedUrl = resolveGoogleDriveConfirmUrl(html)

  if (!confirmedUrl) {
    return new Response(html, {
      status: response.status,
      headers: response.headers,
    })
  }

  return fetch(confirmedUrl, {
    headers: {
      cookie: response.headers.get("set-cookie") ?? "",
    },
  })
}

async function detectCsvFormat() {
  let sample = ""

  if (!CSV_URL) {
    const handle = await fs.open(CSV_PATH, "r")
    try {
      const buffer = Buffer.alloc(4096)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      sample = buffer.toString("utf8", 0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  if (!sample) {
    return {
      delimiter: process.env.METRICAS_CSV_DELIMITER || DEFAULT_CSV_DELIMITER,
      fromLine: Number(process.env.METRICAS_CSV_FROM_LINE || DEFAULT_CSV_FROM_LINE),
    }
  }

  const [firstLine = ""] = sample.split(/\r?\n/)
  const pipeCount = (firstLine.match(/\|/g) ?? []).length
  const semicolonCount = (firstLine.match(/;/g) ?? []).length
  const delimiter = process.env.METRICAS_CSV_DELIMITER || (pipeCount > semicolonCount ? "|" : ";")
  const hasHeader =
    /aviso/i.test(firstLine) ||
    /[áa]rea de empresa/i.test(firstLine) ||
    /status de usuario/i.test(firstLine)

  return {
    delimiter,
    fromLine: Number(process.env.METRICAS_CSV_FROM_LINE || (hasHeader ? 2 : 1)),
  }
}

function resolveDownloadUrl(url: string) {
  const match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)

  if (!match) {
    return url
  }

  return `https://drive.google.com/uc?export=download&id=${match[1]}`
}

function isGoogleDriveUrl(url: string) {
  return url.includes("drive.google.com")
}

function resolveGoogleDriveConfirmUrl(html: string) {
  const actionMatch = html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"/)

  if (!actionMatch) {
    return null
  }

  const params = new URLSearchParams()
  const inputPattern = /<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g
  let inputMatch: RegExpExecArray | null

  while ((inputMatch = inputPattern.exec(html))) {
    params.set(decodeHtml(inputMatch[1]), decodeHtml(inputMatch[2]))
  }

  return `${decodeHtml(actionMatch[1])}?${params.toString()}`
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

async function main() {
  const rowsByDataset: Record<DatasetKey, NormalizedRow[]> = {
    alumbrado: [],
    "paisaje-urbano": [],
  }
  let totalRows = 0
  let skippedRows = 0

  const input = await createInputStream()
  const csvFormat = await detectCsvFormat()
  const parser = parse({
    delimiter: csvFormat.delimiter,
    from_line: csvFormat.fromLine,
    relax_column_count: true,
    quote: false,
  })

  for await (const row of input.pipe(parser) as AsyncIterable<CsvRow>) {
    totalRows += 1

    if (!isCoreRow(row)) {
      skippedRows += 1
      continue
    }

    const datasetKey = getDatasetKey(row)

    if (!datasetKey) {
      continue
    }

    rowsByDataset[datasetKey].push(normalizeRow(row, datasetKey))
  }

  await fs.mkdir(OUT_DIR, { recursive: true })

  for (const [datasetKey, rows] of Object.entries(rowsByDataset) as Array<
    [DatasetKey, NormalizedRow[]]
  >) {
    const snapshot = buildSnapshot(rows)
    const outPath = path.join(
      OUT_DIR,
      datasetKey === "alumbrado"
        ? "alumbrado-dataset.json"
        : "paisaje-urbano-dataset.json"
    )

    await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2), "utf8")
    console.log(`${datasetKey}: ${rows.length.toLocaleString("es-AR")} filas`)
  }

  console.log(`Filas leidas: ${totalRows.toLocaleString("es-AR")}`)
  console.log(`Filas descartadas por campos base: ${skippedRows.toLocaleString("es-AR")}`)
  console.log(`Formato CSV: delimiter=${JSON.stringify(csvFormat.delimiter)} from_line=${csvFormat.fromLine}`)
}

main().catch((error) => {
  console.error("No se pudieron generar los snapshots desde el CSV")
  console.error(error)
  process.exit(1)
})
