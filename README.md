# metricas-tremor-nuevo-csv

Prototipo separado de `metricas-tremor` para alimentar los dashboards desde la
exportacion oficial CSV.

## Snapshots

Generar con el archivo local por defecto:

```powershell
npm run generate-csv-snapshots
```

Generar desde Google Drive:

```powershell
$env:METRICAS_CSV_URL='https://drive.google.com/file/d/1bKrsHLjJ4b5xnpKeKZydkFFNyXjSEOJP/view?usp=sharing'
npm run generate-csv-snapshots
```

Generar desde otra ruta local:

```powershell
$env:METRICAS_CSV_PATH='D:\Descargas\descargaprd6-05\descargaprd6-05.csv'
npm run generate-csv-snapshots
```
