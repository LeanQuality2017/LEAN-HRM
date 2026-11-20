/**
 * Lightweight, zero-dependency PDF 1.4 document builder.
 * Generates strictly compliant Adobe PDF 1.4 binary buffers using standard Type 1 fonts.
 */
export class PdfDocument {
  private width: number = 595.28
  private height: number = 841.89
  private contentStream: string[] = []

  constructor(width = 595.28, height = 841.89) {
    this.width = width
    this.height = height
  }

  save(): this {
    this.contentStream.push('q')
    return this
  }

  restore(): this {
    this.contentStream.push('Q')
    return this
  }

  setFillColor(r: number, g: number, b: number): this {
    this.contentStream.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`)
    return this
  }

  setStrokeColor(r: number, g: number, b: number): this {
    this.contentStream.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`)
    return this
  }

  setLineWidth(w: number): this {
    this.contentStream.push(`${w.toFixed(2)} w`)
    return this
  }

  drawRect(x: number, y: number, w: number, h: number, fill = true, stroke = false): this {
    this.contentStream.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`)
    if (fill && stroke) {
      this.contentStream.push('B')
    } else if (fill) {
      this.contentStream.push('f')
    } else if (stroke) {
      this.contentStream.push('S')
    }
    return this
  }

  drawLine(x1: number, y1: number, x2: number, y2: number): this {
    this.contentStream.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`)
    return this
  }

  drawText(
    text: string,
    x: number,
    y: number,
    options?: {
      font?: 'Helvetica' | 'Helvetica-Bold'
      size?: number
      color?: [number, number, number]
      align?: 'left' | 'right' | 'center'
      width?: number
    }
  ): this {
    const fontName = options?.font === 'Helvetica-Bold' ? '/F2' : '/F1'
    const size = options?.size ?? 10
    const [r, g, b] = options?.color ?? [0, 0, 0]

    // Escape special characters in PDF literal text strings
    const escaped = text
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/₹/g, 'INR ')
      .replace(/[^\x20-\x7E]/g, ' ')

    let posX = x
    if (options?.align === 'right' && options?.width) {
      const charWidth = size * (options.font === 'Helvetica-Bold' ? 0.58 : 0.52)
      const approxTextWidth = text.length * charWidth
      posX = x + options.width - approxTextWidth
    }

    this.contentStream.push('BT')
    this.contentStream.push(`${fontName} ${size} Tf`)
    this.contentStream.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`)
    this.contentStream.push(`${posX.toFixed(2)} ${y.toFixed(2)} Td`)
    this.contentStream.push(`(${escaped}) Tj`)
    this.contentStream.push('ET')
    return this
  }

  build(): Buffer {
    const streamContent = this.contentStream.join('\n')
    const streamBytes = Buffer.from(streamContent, 'utf-8')

    let body = '%PDF-1.4\n'
    const offsets: number[] = []

    function addObj(str: string) {
      offsets.push(Buffer.byteLength(body, 'utf-8'))
      body += str + '\n'
    }

    // 1: Catalog
    addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj')
    // 2: Pages
    addObj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj')
    // 3: Page definition
    addObj(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj`
    )
    // 4: Contents stream
    addObj(`4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${streamContent}\nendstream\nendobj`)
    // 5: Font F1 (Helvetica)
    addObj('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj')
    // 6: Font F2 (Helvetica-Bold)
    addObj('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj')

    const xrefOffset = Buffer.byteLength(body, 'utf-8')
    body += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`
    for (const off of offsets) {
      body += `${off.toString().padStart(10, '0')} 00000 n \n`
    }
    body += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

    return Buffer.from(body, 'utf-8')
  }
}

