const URL_PREFIX = import.meta.env.VITE_URL_PREFIX || ''

export function getBrowserUrl(pipelineName: string, port: number, host?: string): string {
  return `${URL_PREFIX}/d/${host || pipelineName}/${port}/`
}
