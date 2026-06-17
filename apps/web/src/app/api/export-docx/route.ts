import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";

export async function POST(request: Request) {
  const body = await request.json();
  const markdown = String(body.markdown ?? "");
  const lines = markdown.split("\n");
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: lines.map((line) => {
          const heading = line.startsWith("#");
          const text = line.replace(/^#+\s*/, "").replace(/^\-\s*/, "• ");
          return new Paragraph({
            spacing: { after: heading ? 180 : 100 },
            children: [
              new TextRun({
                text,
                bold: heading || /\*\*/.test(line),
                size: heading ? 32 : 22
              })
            ]
          });
        })
      }
    ]
  });
  const buffer = await Packer.toBuffer(doc);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": "attachment; filename=resume.docx"
    }
  });
}
