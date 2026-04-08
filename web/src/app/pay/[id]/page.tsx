import { fetchInvoice } from "@/lib/api";
import PaymentFlow from "@/components/PaymentFlow";

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let invoice;
  let error = "";

  try {
    invoice = await fetchInvoice(id);
  } catch {
    error = "Invoice not found";
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      {error ? (
        <div className="max-w-md mx-auto p-6 text-center">
          <h2 className="text-xl font-bold text-red-600">Not Found</h2>
          <p className="text-gray-500 mt-2">This payment link is invalid.</p>
        </div>
      ) : invoice ? (
        <PaymentFlow invoice={invoice} />
      ) : null}
    </main>
  );
}
