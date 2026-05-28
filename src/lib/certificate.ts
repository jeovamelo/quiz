import jsPDF from "jspdf";

export type CertificateData = {
  participantName: string;
  eventTitle: string;
  presentationTitle?: string | null;
  score: number;
  correctCount: number;
  answerCount: number;
  generatedAt?: Date;
};

export function generateCertificatePdf(data: CertificateData): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // Fundo
  doc.setFillColor(14, 16, 21);
  doc.rect(0, 0, W, H, "F");

  // Borda dupla
  doc.setDrawColor(246, 139, 31);
  doc.setLineWidth(2);
  doc.rect(10, 10, W - 20, H - 20);
  doc.setDrawColor(166, 25, 60);
  doc.setLineWidth(0.5);
  doc.rect(14, 14, W - 28, H - 28);

  // Cabeçalho
  doc.setTextColor(255, 203, 5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("QUIZHUBINE", W / 2, 30, { align: "center" });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(36);
  doc.text("Certificado de Participação", W / 2, 55, { align: "center" });

  // Corpo
  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.setTextColor(200, 200, 200);
  doc.text("Certificamos que", W / 2, 78, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(246, 139, 31);
  doc.text(data.participantName, W / 2, 95, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.setTextColor(220, 220, 220);
  const eventLine = data.presentationTitle
    ? `participou da palestra "${data.presentationTitle}"`
    : "participou de todas as palestras";
  doc.text(eventLine, W / 2, 112, { align: "center" });
  doc.text(`no evento "${data.eventTitle}",`, W / 2, 122, { align: "center" });

  const pct =
    data.answerCount > 0
      ? Math.round((data.correctCount / data.answerCount) * 100)
      : 0;
  doc.text(
    `alcançando ${data.score} pontos com ${data.correctCount} de ${data.answerCount} acertos (${pct}%).`,
    W / 2,
    132,
    { align: "center" },
  );

  // Data
  const d = data.generatedAt ?? new Date();
  const dateStr = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  doc.setFontSize(12);
  doc.setTextColor(180, 180, 180);
  doc.text(`Emitido em ${dateStr}`, W / 2, H - 30, { align: "center" });

  doc.setFontSize(10);
  doc.setTextColor(140, 140, 140);
  doc.text("Documento gerado automaticamente pela plataforma QuizHubine.", W / 2, H - 22, {
    align: "center",
  });

  return doc;
}

export function downloadCertificate(data: CertificateData) {
  const doc = generateCertificatePdf(data);
  const safeName = data.participantName.replace(/[^a-zA-Z0-9-_]+/g, "_");
  const safeEvent = data.eventTitle.replace(/[^a-zA-Z0-9-_]+/g, "_");
  doc.save(`certificado_${safeName}_${safeEvent}.pdf`);
}