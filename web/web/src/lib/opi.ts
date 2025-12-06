export async function generatePacket(caseId: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/cases/${caseId}/generate-packet`, {
    method: 'POST',
  });
  return res.json();
}