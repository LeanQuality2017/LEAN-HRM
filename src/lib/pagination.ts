export interface PaginationParams {
  page: number
  pageSize: number
  skip: number
}

// Parse page (default 1) and pageSize (default 25, cap 100) from URL query
export function parsePaginationParams(url: URL): PaginationParams {
  const pageParam = url.searchParams.get('page')
  const pageSizeParam = url.searchParams.get('pageSize')

  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeParam || '25', 10) || 25))
  const skip = (page - 1) * pageSize

  return { page, pageSize, skip }
}

