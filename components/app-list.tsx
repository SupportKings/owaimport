"use client";

import { useEffect, useState } from "react";
import { AppRecord, fetchAllApps } from "@/lib/airtable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, X } from "lucide-react";

export default function AppList() {
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [filteredApps, setFilteredApps] = useState<AppRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    async function loadApps() {
      try {
        setIsLoading(true);
        const appData = await fetchAllApps();
        setApps(appData);
        setFilteredApps(appData);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch apps:", err);
        setError(
          "Failed to load apps from Airtable. Please check your API key and connection."
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadApps();
  }, []);

  useEffect(() => {
    if (searchTerm.trim() === "") {
      setFilteredApps(apps);
      return;
    }

    const term = searchTerm.toLowerCase();
    const filtered = apps.filter(
      (app) =>
        app.appName.toLowerCase().includes(term) ||
        app.developer.toLowerCase().includes(term) ||
        app.category.toLowerCase().includes(term) ||
        (app.companyWebsite &&
          app.companyWebsite.toLowerCase().includes(term)) ||
        (app.googlePlayId && app.googlePlayId.toLowerCase().includes(term))
    );
    setFilteredApps(filtered);
  }, [searchTerm, apps]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const clearSearch = () => {
    setSearchTerm("");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading apps from Airtable...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative"
        role="alert"
      >
        <strong className="font-bold">Error: </strong>
        <span className="block sm:inline">{error}</span>
      </div>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Apps from Airtable</CardTitle>
        <CardDescription>
          Displaying {filteredApps.length} of {apps.length} apps from your
          Airtable base
        </CardDescription>
        <div className="flex gap-2 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search apps by name, developer, category..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="pl-8"
            />
            {searchTerm && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1.5 h-7 w-7 p-0"
                onClick={clearSearch}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filteredApps.length === 0 ? (
          <p className="text-center py-4 text-gray-500">
            {apps.length === 0
              ? "No apps found in Airtable."
              : "No apps match your search criteria."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App Name</TableHead>
                <TableHead>App ID</TableHead>
                <TableHead>Developer</TableHead>
                <TableHead>Category</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredApps.map((app) => (
                <TableRow key={app.id}>
                  <TableCell className="font-medium">{app.appName}</TableCell>
                  <TableCell>{app.appId}</TableCell>
                  <TableCell>{app.developer}</TableCell>
                  <TableCell>{app.category}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
