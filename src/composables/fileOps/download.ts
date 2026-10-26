/** Shared browser download path for scheme exports and local diagnostics. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    // Let the browser consume the download before releasing its backing URL.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
