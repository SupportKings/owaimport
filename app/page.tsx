import CSVImportForm from "@/csv-import-form";
import { Suspense } from "react";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-8">
      <div className="w-full max-w-5xl flex flex-col gap-8">
        <h1 className="text-3xl font-bold text-center">App Importer </h1>

        <div className="flex justify-center">
          <Suspense fallback={<div>Loading...</div>}>
            <CSVImportForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
