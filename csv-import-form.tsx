"use client";

import type React from "react";

import { useState, useRef, useEffect } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { findAppDuplicates } from "@/lib/airtable";
import { Loader2, ArrowRightLeft, CheckCircle } from "lucide-react";
import { processImport } from "@/app/actions/import-actions";
import { useRouter, useSearchParams } from "next/navigation";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Toaster } from "sonner";

type ImportStep =
  | "upload"
  | "mapping"
  | "csvDuplicates"
  | "validation"
  | "duplicates"
  | "import";

// Schema for app data validation
const appSchema = z.object({
  appName: z.string().min(1, "App name is required"),
  appId: z.string().optional(),
  developer: z.string().optional(),
  category: z.string().optional(),
  country: z.string().optional(),
  companyWebsite: z.string().optional(),
  companyLinkedinUrl: z.string().optional(),
  sensorTowerId: z.string().optional(),
  googlePlayId: z.string().optional(),
  developerId: z.string().optional(),
});

// Fields used for duplicate detection
const duplicateDetectionFields = [
  "appName",
  "companyWebsite",
  "companyLinkedinUrl",
  "sensorTowerId",
  "googlePlayId",
  "developerId",
];

// Add a new type for field resolution
type FieldResolution = "existing" | "imported" | "merged";

// Add new types for duplicate handling
type DuplicateMatchFields = {
  appName: boolean;
  appId: boolean;
  developer: boolean;
  category: boolean;
  country: boolean;
  companyWebsite: boolean;
  companyLinkedinUrl: boolean;
  sensorTowerId: boolean;
  googlePlayId: boolean;
  developerId: boolean;
};

type DuplicateAction = 'keepFirst' | 'keepLast' | 'merge' | 'skip';

// Helper function to calculate final data after merge decisions
function calculateFinalData(
  existingData: any,
  importedData: any,
  resolution: {
    action: "keep" | "replace" | "merge";
    fieldResolutions: { [field: string]: FieldResolution };
  }
): any {
  // If no data or resolution, return null
  if (!existingData || !importedData || !resolution) {
    return null;
  }

  // For keep action, return existing data
  if (resolution.action === "keep") {
    return existingData;
  }

  // For replace action, return imported data
  if (resolution.action === "replace") {
    return importedData;
  }

  // For merge action, combine based on field resolutions
  if (resolution.action === "merge") {
    const result = { ...existingData }; // Start with existing data

    // Apply field-specific resolutions
    Object.entries(resolution.fieldResolutions).forEach(
      ([field, fieldResolution]) => {
        if (fieldResolution === "imported" && importedData[field]) {
          // Use imported value
          result[field] = importedData[field];
        }
        // For "existing", keep the existing value (already in result)
        // For "merged", we'd need more complex logic, but we don't use this value currently
      }
    );

    return result;
  }

  // Fallback
  return existingData;
}

// Update the type to include mergeFields
type CsvDuplicateResolution = {
  action: DuplicateAction;
  selectedIndex: number;
  mergeFields?: {
    [field: string]: number;  // Maps field name to record index
  };
};

// Add campaign ID to the component props
interface CSVImportFormProps {
  campaignId?: string;
}

interface StepDotProps {
  label: string;
  active: boolean;
  completed: boolean;
}

function StepDot({ label, active, completed }: StepDotProps) {
  return (
    <div className="flex flex-col items-center relative">
      <div 
        className={cn(
          "w-6 h-6 rounded-full z-10 flex items-center justify-center transition-all duration-300 bg-white",
          active ? "bg-primary border-4 border-primary-foreground" : 
          completed ? "bg-primary" : "border-2 border-gray-300"
        )}
      />
      <span 
        className={cn(
          "text-xs mt-3 text-center max-w-[80px] absolute top-8",
          active ? "text-primary font-semibold" : 
          completed ? "text-gray-700" : "text-gray-500"
        )}
      >
        {label}
      </span>
    </div>
  );
}

// Add this helper function to extract root domain from URLs
function extractRootDomain(url: string): string {
  if (!url) return '';
  
  try {
    // Add protocol if missing
    if (!url.match(/^https?:\/\//i)) {
      url = 'https://' + url;
    }
    
    // Parse URL
    const parsedUrl = new URL(url);
    
    // Get hostname and remove 'www.' if present
    let domain = parsedUrl.hostname.toLowerCase();
    domain = domain.replace(/^www\./i, '');
    
    return domain;
  } catch (error) {
    // If URL parsing fails, try simple regex extraction
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/]+)/i);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
    
    // Return original if nothing else works
    return url;
  }
}

// Update the available fields type
type AvailableField = {
  value: string;
  label: string;
  isCustom?: boolean;
};

// Add this interface to ensure customfields can be added dynamically
interface AppWithCustomFields {
  appName: string;
  appId: string;
  developer: string;
  category: string;
  country: string;
  companyWebsite: string;
  companyLinkedinUrl: string;
  sensorTowerId: string;
  googlePlayId: string;
  developerId: string;
  rootDomain: string;
  customfields?: { [key: string]: string };
  _originalIndex?: number;
}

export default function CSVImportForm({ campaignId }: CSVImportFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<{ [key: string]: string }>({});
  const [step, setStep] = useState<ImportStep>("upload");
  const [data, setData] = useState<any[]>([]);
  const [invalidData, setInvalidData] = useState<any[]>([]);
  const [csvDuplicates, setCsvDuplicates] = useState<any[]>([]);
  const [csvDuplicateResolutions, setCsvDuplicateResolutions] = useState<{
    [key: string]: CsvDuplicateResolution;
  }>({});
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [duplicateResolutions, setDuplicateResolutions] = useState<{
    [key: string]: {
      action: "keep" | "replace" | "merge";
      fieldResolutions: { [field: string]: FieldResolution };
    };
  }>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<{
    success?: boolean;
    message?: string;
    analyzed?: number;
    duplicatesFound?: number;
    errors?: string[];
    webhookSuccess?: boolean;
  }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get recordID from URL query params
  const recordId = searchParams.get("recordID");

  // Add debug log to check recordId
  useEffect(() => {
    console.log("Record ID from URL:", recordId);
  }, [recordId]);

  // Update the initial state for duplicate match fields
  const [duplicateMatchFields, setDuplicateMatchFields] = useState<DuplicateMatchFields>({
    appName: true,
    appId: false,
    developer: false,
    category: false,
    country: false,
    companyWebsite: false,
    companyLinkedinUrl: false,
    sensorTowerId: false,
    googlePlayId: false,
    developerId: false,
  });

  // Add new state for bulk action
  const [bulkDuplicateAction, setBulkDuplicateAction] = useState<DuplicateAction>('keepFirst');

  // Add state for Airtable match fields
  const [airtableMatchFields, setAirtableMatchFields] = useState<DuplicateMatchFields>({
    appName: true,
    appId: false,
    developer: false,
    category: false,
    country: false,
    companyWebsite: false,
    companyLinkedinUrl: false,
    sensorTowerId: false,
    googlePlayId: false,
    developerId: false,
  });

  // Add a function to get a stable string representation of the match fields
  const getMatchFieldsKey = (fields: DuplicateMatchFields) => {
    return Object.entries(fields)
      .filter(([_, selected]) => selected)
      .map(([field]) => field)
      .sort()
      .join(',');
  };

  // Update the useEffect to use the stable key
  useEffect(() => {
    if (step === "csvDuplicates" && data.length > 0 && mappings["appName"]) {
      checkForCsvDuplicates();
    }
  }, [
    data, 
    mappings, 
    step, 
    getMatchFieldsKey(duplicateMatchFields)
  ]); // Use stable string key instead of object

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      parseCSV(selectedFile);
    }
  };

  const parseCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const lines = content.split("\n");
      const headers = lines[0].split(",").map((h) => h.trim());
      setHeaders(headers);

      // Auto-map columns with matching names
      const initialMappings: { [key: string]: string } = {};
      headers.forEach((header) => {
        // Check for exact matches (case insensitive)
        const matchingField = availableFields.find(
          (field) => field.label.toLowerCase() === header.toLowerCase()
        );
        if (matchingField) {
          initialMappings[matchingField.value] = header;
        } else {
          // If no match is found, map it as a custom field by default
          initialMappings[`custom_${header}`] = header;
          console.log(`Automatically mapped column "${header}" as a custom field`);
        }
      });
      setMappings(initialMappings);

      const parsedData = lines.slice(1).map((line) => {
        const values = line.split(",");
        return headers.reduce((obj, header, index) => {
          obj[header] = values[index]?.trim();
          return obj;
        }, {} as any);
      });
      setData(parsedData);

      // Check if all required fields are mapped
      // At minimum, we need appName (the only required field in our schema)
      const hasRequiredMappings = !!initialMappings["appName"];

      // Count how many fields were automatically mapped
      const mappedFieldsCount = Object.keys(initialMappings).length;
      const totalFieldsCount = availableFields.length;

      // If all required fields are mapped, we can skip the mapping step
      if (hasRequiredMappings) {
        // If all fields are mapped, go straight to validation
        // Otherwise, show mapping screen but with a success message
        if (mappedFieldsCount === totalFieldsCount) {
          // Check for CSV duplicates before proceeding
          setStep("mapping");
          // We'll check for duplicates in handleNextStep
        } else {
          // We have the required fields but not all fields are mapped
          // Show a notification and let the user decide if they want to map more fields
          toast.success(
            `${mappedFieldsCount} out of ${totalFieldsCount} columns were automatically mapped. Required fields are mapped, but you can map additional fields if needed.`
          );
          setStep("mapping");
        }
      } else {
        // Required fields are missing, must go to mapping step
        setStep("mapping");
      }
    };
    reader.readAsText(file);
  };

  const handleMappingChange = (header: string, value: string) => {
    setMappings(prev => {
      const newMappings = { ...prev };
      
      // First remove this header from any existing mapping
      Object.keys(newMappings).forEach(key => {
        if (newMappings[key] === header) {
          delete newMappings[key];
        }
      });
      
      // Then add the new mapping
      newMappings[value] = header;
      
      console.log(`Set mapping: "${value}" => "${header}"`);
      if (value.startsWith('custom_')) {
        console.log(`This is a custom field mapping!`);
      }
      
      return newMappings;
    });
  };

  const validateData = () => {
    const invalid = data
      .map((row) => {
        const formattedRow = {
          appName: row[mappings["appName"]] || "",
          appId: row[mappings["appId"]] || "",
          developer: row[mappings["developer"]] || "",
          category: row[mappings["category"]] || "",
          country: row[mappings["country"]] || "",
          companyWebsite: row[mappings["companyWebsite"]] || "",
          companyLinkedinUrl: row[mappings["companyLinkedinUrl"]] || "",
          sensorTowerId: row[mappings["sensorTowerId"]] || "",
          googlePlayId: row[mappings["googlePlayId"]] || "",
          developerId: row[mappings["developerId"]] || "",
        };

        const validationResult = appSchema.safeParse(formattedRow);
        return {
          ...row,
          isValid: validationResult.success,
          errors: validationResult.success
            ? {}
            : validationResult.error.flatten().fieldErrors,
        };
      })
      .filter((row) => !row.isValid);
    setInvalidData(invalid);
    return invalid.length === 0;
  };

  const checkForCsvDuplicates = () => {
    console.log("Checking CSV duplicates with fields:", duplicateMatchFields);
    const duplicateGroups: { [key: string]: any[] } = {};
    const csvDuplicatesFound: {
      key: string;
      records: any[];
      matchedOn: string[];
    }[] = [];

    // Get selected match fields
    const selectedMatchFields = Object.entries(duplicateMatchFields)
      .filter(([_, selected]) => selected)
      .map(([field]) => field);

    console.log("Selected match fields:", selectedMatchFields);

    if (selectedMatchFields.length === 0) {
      console.log("No match fields selected");
      setCsvDuplicates([]);
      setCsvDuplicateResolutions({});
      return false;
    }

    // Process each row
    data.forEach((row, index) => {
      const appData = {
        appName: row[mappings["appName"]] || "",
        appId: row[mappings["appId"]] || "",
        developer: row[mappings["developer"]] || "",
        category: row[mappings["category"]] || "",
        country: row[mappings["country"]] || "",
        companyWebsite: row[mappings["companyWebsite"]] || "",
        companyLinkedinUrl: row[mappings["companyLinkedinUrl"]] || "",
        sensorTowerId: row[mappings["sensorTowerId"]] || "",
        googlePlayId: row[mappings["googlePlayId"]] || "",
        developerId: row[mappings["developerId"]] || "",
        _originalIndex: index,
      };

      // Create a composite key from all selected match fields
      const key = selectedMatchFields
        .map(field => {
          const value = appData[field as keyof typeof appData];
          return `${field}:${value}`;
        })
        .join('|');

      if (!duplicateGroups[key]) {
        duplicateGroups[key] = [];
      }
      duplicateGroups[key].push(appData);
    });

    console.log("Duplicate groups:", duplicateGroups);

    // Find groups with more than one record
    Object.entries(duplicateGroups).forEach(([key, records]) => {
      if (records.length > 1) {
        csvDuplicatesFound.push({
          key,
          records,
          matchedOn: selectedMatchFields,
        });
      }
    });

    console.log("CSV duplicates found:", csvDuplicatesFound);

    setCsvDuplicates(csvDuplicatesFound);

    // Initialize resolutions based on bulk action
    if (csvDuplicatesFound.length > 0) {
      const initialResolutions = csvDuplicatesFound.reduce((acc, group) => {
        const selectedIndex = bulkDuplicateAction === 'keepFirst' 
          ? group.records[0]._originalIndex 
          : bulkDuplicateAction === 'keepLast'
            ? group.records[group.records.length - 1]._originalIndex
            : group.records[0]._originalIndex;

        acc[group.key] = {
          action: bulkDuplicateAction,
          selectedIndex,
        };
        return acc;
      }, {} as { [key: string]: CsvDuplicateResolution });

      setCsvDuplicateResolutions(initialResolutions);
    }

    return csvDuplicatesFound.length > 0;
  };

  const checkForDuplicates = async () => {
    setIsLoading(true);
    try {
      console.log("Starting Airtable duplicate check with recordId:", recordId);
      if (!recordId) {
        console.warn("No record ID provided in URL");
        return false;
      }

      const duplicatesFound = [];
      
      // Get the deduplicated data after CSV duplicate resolution
      const deduplicatedData = data.filter((row, index) => {
        const duplicateGroup = csvDuplicates.find(group => 
          group.records.some((record: { _originalIndex: number }) => record._originalIndex === index)
        );

        if (!duplicateGroup) return true;
        const resolution = csvDuplicateResolutions[duplicateGroup.key];
        if (!resolution) return true;
        if (resolution.action === 'merge') {
          return duplicateGroup.records[0]._originalIndex === index;
        }
        return resolution.selectedIndex === index;
      });

      console.log("Checking Airtable duplicates for records:", deduplicatedData.length);

      // Process each deduplicated row
      for (const row of deduplicatedData) {
        const appData = {
          appName: row[mappings["appName"]] || "",
          appId: row[mappings["appId"]] || "",
          developer: row[mappings["developer"]] || "",
          category: row[mappings["category"]] || "",
          country: row[mappings["country"]] || "",
          companyWebsite: row[mappings["companyWebsite"]] || "",
          companyLinkedinUrl: row[mappings["companyLinkedinUrl"]] || "",
          sensorTowerId: row[mappings["sensorTowerId"]] || "",
          googlePlayId: row[mappings["googlePlayId"]] || "",
          developerId: row[mappings["developerId"]] || "",
        };

        try {
          const potentialDuplicates = await findAppDuplicates(appData, recordId);
          console.log("Found Airtable duplicates:", potentialDuplicates);

          if (potentialDuplicates.length > 0) {
            // Determine which fields matched
            const matchedFields = [];
            if (potentialDuplicates.some(dup => dup.appName === appData.appName)) {
              matchedFields.push("appName");
            }
            if (potentialDuplicates.some(dup => dup.appId === appData.appId)) {
              matchedFields.push("appId");
            }
            if (potentialDuplicates.some(dup => dup.googlePlayId === appData.googlePlayId)) {
              matchedFields.push("googlePlayId");
            }
            if (potentialDuplicates.some(dup => dup.sensorTowerId === appData.sensorTowerId)) {
              matchedFields.push("sensorTowerId");
            }

            duplicatesFound.push({
              importData: appData,
              duplicates: potentialDuplicates,
              matchedOn: matchedFields,
            });
          }
        } catch (err) {
          console.error(`Error checking duplicates for ${appData.appName}:`, err);
        }
      }

      console.log("Total Airtable duplicates found:", duplicatesFound.length);
      setDuplicates(duplicatesFound);

      // Initialize duplicate resolutions
      if (duplicatesFound.length > 0) {
        const initialResolutions = duplicatesFound.reduce((acc, dup) => {
          dup.duplicates.forEach(duplicate => {
            acc[duplicate.id] = {
              action: "keep",
              fieldResolutions: {
                appName: "existing",
                appId: "existing",
                developer: "existing",
                category: "existing",
                country: "existing",
                companyWebsite: "existing",
                companyLinkedinUrl: "existing",
                sensorTowerId: "existing",
                googlePlayId: "existing",
                developerId: "existing",
              }
            };
          });
          return acc;
        }, {} as { [key: string]: { action: "keep" | "replace" | "merge"; fieldResolutions: { [field: string]: FieldResolution } } });

        setDuplicateResolutions(initialResolutions);
      }

      return duplicatesFound.length > 0;
    } catch (error) {
      console.error("Error checking for duplicates:", error);
      toast.error(`Failed to check for duplicates: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const handleNextStep = async () => {
    setIsLoading(true);
    try {
      console.log("Current step:", step);
      switch (step) {
        case "upload":
          setStep("mapping");
          break;

        case "mapping":
          if (!mappings["appName"]) {
            toast.error("Please map the App Name field before proceeding.");
            return;
          }
          setStep("csvDuplicates");
          break;

        case "csvDuplicates":
          setStep("validation");
          break;

        case "validation":
          if (!validateData()) {
            return;
          }
          const hasDuplicates = await checkForDuplicates();
          console.log("Airtable duplicates found:", hasDuplicates);
          if (hasDuplicates) {
            setStep("duplicates");
          } else {
            setStep("import");
          }
          break;

        case "duplicates":
          setStep("import");
          break;

        case "import":
          // Handle the final import here
          await handleImport();
          break;
      }
    } catch (error) {
      console.error("Error in handleNextStep:", error);
      toast.error(`An error occurred: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDataCorrection = (
    index: number,
    field: string,
    value: string
  ) => {
    const newInvalidData = [...invalidData];
    newInvalidData[index][mappings[field]] = value;
    setInvalidData(newInvalidData);

    const dataIndex = data.findIndex(
      (item) =>
        item[mappings["appName"]] === newInvalidData[index][mappings["appName"]]
    );
    if (dataIndex !== -1) {
      const newData = [...data];
      newData[dataIndex][mappings[field]] = value;
      setData(newData);
    }
  };

  const handleDuplicateResolution = (
    id: string,
    action: "keep" | "replace" | "merge"
  ) => {
    setDuplicateResolutions((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        action,
      },
    }));
    toast.success("Duplicate resolutions saved successfully");
  };
  const handleCsvDuplicateResolution = (key: string, selectedIndex: number) => {
    setCsvDuplicateResolutions((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        action: "keep" as DuplicateAction,
        selectedIndex,
      },
    }));
    toast.success("CSV duplicates resolved successfully");
  };

  const handleFieldResolution = (
    id: string,
    field: string,
    resolution: FieldResolution
  ) => {
    setDuplicateResolutions((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        fieldResolutions: {
          ...prev[id].fieldResolutions,
          [field]: resolution,
        },
      },
    }));
  };

  const handleImport = async () => {
    setIsLoading(true);
    try {
      // Process the import with the resolved duplicates and mappings
      const result = await processImport(data, mappings, duplicateResolutions);
      setImportResult(result);

      // Get recordID from URL if it exists
      const recordID = searchParams.get("recordID");

      // Send data to webhook
      try {
        const webhookUrl = process.env.NEXT_PUBLIC_WEBHOOK_URL || "https://hook.eu2.make.com/nx1f2r4pjtc0ep15xd1tqts4vtxouso6";

        // STEP 1: Debug all input data
        console.log("======= DETAILED DEBUG =======");
        console.log("CSV data length:", data.length);
        console.log("First CSV row:", data[0]);
        console.log("CSV duplicates:", csvDuplicates.length);
        console.log("First CSV duplicate group:", csvDuplicates[0]);
        console.log("Airtable duplicates:", duplicates.length);
        console.log("First Airtable duplicate:", duplicates[0]);
        
        // STEP 2: Create a simple mapping of what to keep after CSV deduplication
        console.log("Building list of records to keep after CSV deduplication...");
        
        // First, everything that's not in a duplicate group is automatically kept
        const keepIndices = new Set<number>();
        
        // Map each row to a "keep" decision and track the reason
        const rowDecisions = data.map((row, index) => {
          // Check if this row is in any CSV duplicate group
          const duplicateGroup = csvDuplicates.find(group => 
            group.records.some((record: { _originalIndex: number }) => record._originalIndex === index)
          );
          
          if (!duplicateGroup) {
            // Not in any duplicate group, so keep it
            keepIndices.add(index);
            return { index, keep: true, reason: "Not in any duplicate group" };
          }
          
          // It's in a duplicate group, so check resolution
          const groupKey = duplicateGroup.key;
          const resolution = csvDuplicateResolutions[groupKey];
          
          if (!resolution) {
            // No resolution for this group, default to keeping first record
            const keep = duplicateGroup.records[0]._originalIndex === index;
            if (keep) keepIndices.add(index);
            return { 
              index, 
              keep, 
              reason: keep ? "First record in group with no resolution" : "Not the first record in group with no resolution" 
            };
          }
          
          // There is a resolution, check if this is the selected index
          const keep = resolution.selectedIndex === index;
          if (keep) keepIndices.add(index);
          return { 
            index, 
            keep, 
            reason: keep ? `Selected in resolution for group ${groupKey}` : `Not selected in resolution for group ${groupKey}` 
          };
        });
        
        // Log detailed decisions for debugging
        console.log("Row decisions:", rowDecisions);
        console.log("Rows to keep:", Array.from(keepIndices));
        
        // STEP 3: Create formatted records from kept indices only
        const formattedRecords = [];
        for (let i = 0; i < data.length; i++) {
          if (keepIndices.has(i)) {
            const row = data[i];
            const companyWebsite = row[mappings["companyWebsite"]] || "";
            
            // Prepare custom fields - improve debugging
            const custom_fields: { [key: string]: string } = {};
            Object.entries(mappings).forEach(([field, header]) => {
              console.log(`Checking mapping: "${field}" => "${header}"`);
              if (field.startsWith('custom_')) {
                const customFieldName = field.replace('custom_', '');
                const fieldValue = row[header] || "";
                custom_fields[customFieldName] = fieldValue;
                console.log(`Added custom field: ${customFieldName} = ${fieldValue}`);
              }
            });
            
            console.log("Custom fields for record:", custom_fields);
            console.log("Custom fields count:", Object.keys(custom_fields).length);

            // Create the record with explicit customfields property
            const record: AppWithCustomFields = {
              appName: row[mappings["appName"]] || "",
              appId: row[mappings["appId"]] || "",
              developer: row[mappings["developer"]] || "",
              category: row[mappings["category"]] || "",
              country: row[mappings["country"]] || "",
              companyWebsite: companyWebsite,
              companyLinkedinUrl: row[mappings["companyLinkedinUrl"]] || "",
              sensorTowerId: row[mappings["sensorTowerId"]] || "",
              googlePlayId: row[mappings["googlePlayId"]] || "",
              developerId: row[mappings["developerId"]] || "",
              rootDomain: extractRootDomain(companyWebsite),
              _originalIndex: i
            };
            
            // Only add customfields if there are any
            if (Object.keys(custom_fields).length > 0) {
              record.customfields = custom_fields;
            }
            
            formattedRecords.push(record);
          }
        }
        
        // Log the formatted records to verify customfields are included
        console.log("First formatted record with custom fields:", formattedRecords[0]);
        
        // STEP 4: Now check each formatted record against Airtable duplicates
        // This is the critical step where we need to identify which records are truly new
        
        // First, examine the Airtable duplicates structure
        console.log("Examining Airtable duplicates structure:");
        if (duplicates.length > 0) {
          console.log("Sample duplicate importData:", duplicates[0].importData);
          console.log("Sample duplicate matches:", duplicates[0].duplicates ? duplicates[0].duplicates.length : "None");
          if (duplicates[0].duplicates && duplicates[0].duplicates.length > 0) {
            console.log("Sample duplicate match:", duplicates[0].duplicates[0]);
          }
        }
        
        // Now check each record against Airtable duplicates with detailed logging
        const recordsWithAirtableStatus = formattedRecords.map(record => {
          // Check if this record matches any duplicate in Airtable
          let matchFound = false;
          let matchDetails = null;
          
          for (const duplicate of duplicates) {
            // Compare imported data with this record
            const importData = duplicate.importData;
            
            // Check for matches on various fields
            if (importData.appName === record.appName) {
              matchFound = true;
              matchDetails = { field: "appName", value: record.appName };
              break;
            }
            
            if (record.appId && importData.appId === record.appId) {
              matchFound = true;
              matchDetails = { field: "appId", value: record.appId };
              break;
            }
            
            if (record.googlePlayId && importData.googlePlayId === record.googlePlayId) {
              matchFound = true;
              matchDetails = { field: "googlePlayId", value: record.googlePlayId };
              break;
            }
            
            if (record.sensorTowerId && importData.sensorTowerId === record.sensorTowerId) {
              matchFound = true;
              matchDetails = { field: "sensorTowerId", value: record.sensorTowerId };
              break;
            }
          }
          
          return {
            record,
            appName: record.appName,
            inAirtable: matchFound,
            matchDetails
          };
        });
        
        // Log detailed results of duplicate checking
        console.log("Records with Airtable status:", 
          recordsWithAirtableStatus.map(item => ({
            appName: item.appName,
            inAirtable: item.inAirtable,
            matchDetails: item.matchDetails
          }))
        );
        
        // Filter for new apps
        const newApps = recordsWithAirtableStatus
          .filter(item => !item.inAirtable)
          .map(item => {
            // Keep the entire record but remove _originalIndex
            const { _originalIndex, ...record } = item.record;
            console.log("New app with custom fields:", record);
            return record;
          });
        
        console.log("New apps count:", newApps.length);
        console.log("First new app:", newApps[0]);
        
        // Log what actual mappings contain custom fields
        console.log("Mappings that should generate custom fields:");
        Object.entries(mappings).forEach(([field, header]) => {
          if (field.startsWith('custom_')) {
            console.log(`  ${field} => ${header}`);
          }
        });

        // We need to restore this code for preparing updatedApps and unchangedApps
        // Get lists of Airtable record IDs for each action type
        const unchangedIds = Object.entries(duplicateResolutions)
          .filter(([_, resolution]) => resolution.action === "keep")
          .map(([id]) => id);

        const updatedIds = Object.entries(duplicateResolutions)
          .filter(([_, resolution]) => ["replace", "merge"].includes(resolution.action))
          .map(([id]) => id);

        console.log("Airtable records to keep unchanged:", unchangedIds.length);
        console.log("Airtable records to update:", updatedIds.length);

        // Prepare the unchanged apps data
        const unchangedApps = unchangedIds.map(id => {
          const duplicate = duplicates.find(d => 
            d.duplicates.some((dup: { id: string }) => dup.id === id)
          );
          const matchingDup = duplicate?.duplicates.find((dup: { id: string }) => dup.id === id);
          
          // Add rootDomain if there's data
          if (matchingDup && matchingDup.companyWebsite) {
            matchingDup.rootDomain = extractRootDomain(matchingDup.companyWebsite);
          }
          
          // Add custom fields from the imported data
          const importedData = duplicate?.importData;
          const custom_fields: { [key: string]: string } = {};
          if (importedData) {
            Object.entries(mappings).forEach(([field, header]) => {
              if (field.startsWith('custom_')) {
                const originalHeader = header;
                custom_fields[originalHeader] = importedData[header] || "";
              }
            });
          }
          
          return {
            id,
            data: {
              ...matchingDup,
              customfields: Object.keys(custom_fields).length > 0 ? custom_fields : undefined
            }
          };
        });

        // Prepare the updated apps data
        const updatedApps = updatedIds.map(id => {
          const duplicate = duplicates.find(d => 
            d.duplicates.some((dup: { id: string }) => dup.id === id)
          );
          const matchingDup = duplicate?.duplicates.find((dup: { id: string }) => dup.id === id);
          const importedData = duplicate?.importData;
          const resolution = duplicateResolutions[id];
          const finalData = calculateFinalData(matchingDup, importedData, resolution);
          
          // Add rootDomain to finalData
          if (finalData && finalData.companyWebsite) {
            finalData.rootDomain = extractRootDomain(finalData.companyWebsite);
          }
          
          // Add custom fields from the imported data
          const custom_fields: { [key: string]: string } = {};
          if (importedData) {
            Object.entries(mappings).forEach(([field, header]) => {
              if (field.startsWith('custom_')) {
                const originalHeader = header;
                custom_fields[originalHeader] = importedData[header] || "";
              }
            });
          }
          
          // Add custom_fields to finalData
          if (finalData) {
            finalData.customfields = Object.keys(custom_fields).length > 0 ? custom_fields : undefined;
          }
          
          return {
            id,
            existingData: matchingDup,
            newData: importedData,
            action: resolution.action,
            fieldResolutions: resolution.action === "merge" ? resolution.fieldResolutions : undefined,
            finalData
          };
        });

        // Now use newAppsWithCustomFields in the webhook data
        const webhookData = {
          recordID,
          newApps,
          updatedApps,
          unchangedApps,
          summary: {
            totalProcessed: formattedRecords.length,
            newApps: newApps.length,
            updatedApps: updatedApps.length,
            unchangedApps: unchangedApps.length,
          },
          result,
        };

        // Add debug logging
        console.log("Webhook data being sent:", JSON.stringify(webhookData, null, 2));

        // Send the webhook data
        const webhookResponse = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(webhookData),
        });

        if (!webhookResponse.ok) {
          console.error("Webhook notification failed:", await webhookResponse.text());
        } else {
          console.log("Webhook notification sent successfully");
          setImportResult(prev => ({
            ...prev,
            webhookSuccess: true,
          }));
          toast.success("Data successfully sent to webhook");
        }
      } catch (webhookError) {
        console.error("Error sending webhook notification:", webhookError);
      }

      // Show alert notification
      if (result.success) {
        toast.success(`Import complete: ${result.message}`);
      } else {
        toast.error(`Import completed with issues: ${result.message}`);
      }
    } catch (error) {
      console.error("Import error:", error);
      setImportResult({
        success: false,
        message: `Import failed: ${error instanceof Error ? error.message : String(error)}`,
        errors: [(error instanceof Error ? error.message : String(error))]
      });
    } finally {
      setIsLoading(false);
    }
  };

  const downloadTestCSV = () => {
    const testData = `App Name,App ID,Developer,Category,Company Website,Company LinkedIn URL,Sensor Tower ID,Google Play ID,Developer ID
Deepstash: Smarter Every Day!,1445023295,Deepstash,Education,https://deepstash.com/,https://www.linkedin.com/company/deepstash/,12345,com.deepstash.app,20600008385014
LogicLike: Kids Learning Games,1565113819,LogicLike,Education,https://logiclike.com,https://www.linkedin.com/company/logiclike/,67890,com.logiclike.app,388641449
Moshi Kids: Sleep Relax Play,1306719339,Mind Candy,Education,https://www.moshikids.com/,https://www.linkedin.com/company/moshi-kids/,54321,com.moshikids.app,1536338699
Smart Tales: Play & Learn 2-11,1452196861,Marshmallow Games,Education,https://www.marshmallow-games.com/,https://www.linkedin.com/company/marshmallow-games/,98765,com.marshmallow.smarttales,1464656258
Vocal Image: AI Voice Coach,1535324205,Vocal Image,Education,https://www.vocalimage.app/,https://www.linkedin.com/company/vocal-image/,24680,com.vocalimage.app,823443086`;

    const blob = new Blob([testData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "test_apps.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderCsvDuplicatesStep = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">CSV Duplicates</h3>
      
      {/* Match Fields Selection */}
      <Card className="p-4">
        <h4 className="font-medium mb-2">Select fields to match on (AND logic)</h4>
        <div className="grid grid-cols-3 gap-4">
          {Object.entries(duplicateMatchFields).map(([field, checked]) => (
            <div key={field} className="flex items-center space-x-2">
              <Checkbox
                id={`match-${field}`}
                checked={!!checked}
                onCheckedChange={(checked) => handleMatchFieldChange(field, checked)}
              />
              <Label htmlFor={`match-${field}`}>{field}</Label>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 bg-blue-50 rounded">
          <p className="text-sm text-blue-700">
            Currently matching on: {Object.entries(duplicateMatchFields)
              .filter(([_, checked]) => checked)
              .map(([field]) => field)
              .join(" AND ") || "No fields selected"}
          </p>
        </div>
      </Card>

      {/* Bulk Action Selection */}
      <Card className="p-4">
        <h4 className="font-medium mb-2">Bulk Action for All Duplicates</h4>
        <Select
          value={bulkDuplicateAction}
          onValueChange={(value: DuplicateAction) => {
            setBulkDuplicateAction(value);
            // Update all resolutions with the new action
            if (value !== 'merge') {
              const newResolutions = { ...csvDuplicateResolutions };
              csvDuplicates.forEach(group => {
                newResolutions[group.key] = {
                  action: value,
                  selectedIndex: value === 'keepFirst' 
                    ? group.records[0]._originalIndex
                    : value === 'keepLast'
                      ? group.records[group.records.length - 1]._originalIndex
                      : group.records[0]._originalIndex
                };
              });
              setCsvDuplicateResolutions(newResolutions);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keepFirst">Keep First Occurrence</SelectItem>
            <SelectItem value="keepLast">Keep Last Occurrence</SelectItem>
            <SelectItem value="merge">Merge Fields</SelectItem>
            <SelectItem value="skip">Skip Duplicates</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      {/* Duplicate Groups */}
      {csvDuplicates.map((group, groupIndex) => (
        <Card key={groupIndex} className="p-4 mb-4">
          <div className="flex flex-col space-y-2">
            <h4 className="font-semibold">Duplicate Group {groupIndex + 1}</h4>
            <div className="bg-blue-50 p-2 rounded text-sm">
              <p className="font-medium">Matched on: {group.matchedOn.join(" AND ")}</p>
            </div>

            {/* Per-group action selection */}
            <Select
              value={csvDuplicateResolutions[group.key]?.action}
              onValueChange={(value: DuplicateAction) => {
                setCsvDuplicateResolutions(prev => ({
                  ...prev,
                  [group.key]: {
                    action: value,
                    selectedIndex: value === 'keepFirst'
                      ? group.records[0]._originalIndex
                      : value === 'keepLast'
                        ? group.records[group.records.length - 1]._originalIndex
                        : prev[group.key]?.selectedIndex || group.records[0]._originalIndex
                  }
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select action for this group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keepFirst">Keep First Occurrence</SelectItem>
                <SelectItem value="keepLast">Keep Last Occurrence</SelectItem>
                <SelectItem value="merge">Merge Fields</SelectItem>
                <SelectItem value="skip">Skip Duplicates</SelectItem>
              </SelectContent>
            </Select>

            {/* Detailed records table */}
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Select</TableHead>
                  {Object.keys(duplicateMatchFields).map(field => (
                    <TableHead 
                      key={field} 
                      className={cn(
                        "whitespace-nowrap",
                        duplicateMatchFields[field as keyof DuplicateMatchFields] 
                          ? "font-bold text-primary" 
                          : "text-gray-500"
                      )}
                    >
                      {field}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.records.map((record: any, recordIndex: number) => (
                  <TableRow 
                    key={recordIndex}
                    className={cn(
                      csvDuplicateResolutions[group.key]?.action !== 'merge' &&
                      csvDuplicateResolutions[group.key]?.selectedIndex === record._originalIndex 
                        ? "bg-green-50" 
                        : "",
                      csvDuplicateResolutions[group.key]?.action === 'skip'
                        ? "bg-gray-50"
                        : ""
                    )}
                  >
                    <TableCell>
                      {csvDuplicateResolutions[group.key]?.action !== 'merge' && (
                        <RadioGroup
                          value={String(csvDuplicateResolutions[group.key]?.selectedIndex)}
                          onValueChange={(value) =>
                            setCsvDuplicateResolutions(prev => ({
                              ...prev,
                              [group.key]: {
                                ...prev[group.key],
                                selectedIndex: parseInt(value)
                              }
                            }))
                          }
                        >
                          <RadioGroupItem
                            value={String(record._originalIndex)}
                            id={`select-${groupIndex}-${recordIndex}`}
                            disabled={csvDuplicateResolutions[group.key]?.action === 'skip'}
                          />
                        </RadioGroup>
                      )}
                      {csvDuplicateResolutions[group.key]?.action === 'merge' && (
                        <div className="text-center text-sm text-gray-500">
                          {recordIndex + 1}
                        </div>
                      )}
                    </TableCell>
                    {Object.keys(duplicateMatchFields).map(field => (
                      <TableCell key={field}>
                        {csvDuplicateResolutions[group.key]?.action === 'merge' ? (
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              checked={csvDuplicateResolutions[group.key]?.mergeFields?.[field] === recordIndex}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setCsvDuplicateResolutions(prev => ({
                                    ...prev,
                                    [group.key]: {
                                      ...prev[group.key],
                                      mergeFields: {
                                        ...prev[group.key].mergeFields,
                                        [field]: recordIndex
                                      }
                                    }
                                  }));
                                }
                              }}
                            />
                            <span className={cn(
                              csvDuplicateResolutions[group.key]?.mergeFields?.[field] === recordIndex
                                ? "font-medium"
                                : "text-gray-500"
                            )}>
                              {record[field] || "(empty)"}
                            </span>
                          </div>
                        ) : (
                          <span>{record[field] || "(empty)"}</span>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Preview of result */}
            {csvDuplicateResolutions[group.key]?.action === 'merge' && (
              <div className="mt-4 p-3 bg-green-50 rounded border border-green-200">
                <h5 className="font-medium mb-2">Merged Result Preview:</h5>
                <div className="grid grid-cols-3 gap-2">
                  {Object.keys(duplicateMatchFields).map(field => {
                    const selectedRecordIndex = csvDuplicateResolutions[group.key]?.mergeFields?.[field];
                    const value = selectedRecordIndex !== undefined 
                      ? group.records[selectedRecordIndex][field]
                      : "(not selected)";
                    
                    return (
                      <div key={field} className="flex justify-between">
                        <span className={cn(
                          "font-medium",
                          duplicateMatchFields[field as keyof DuplicateMatchFields] 
                            ? "text-primary" 
                            : ""
                        )}>
                          {field}:
                        </span>
                        <span>{value}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Card>
      ))}

      {/* Summary section */}
      <Card className="p-4">
        <h4 className="font-medium mb-2">Summary</h4>
        <div className="space-y-1">
          <p>Total duplicate groups: {csvDuplicates.length}</p>
          <p>Records to be kept: {csvDuplicates.reduce((count, group) => {
            const resolution = csvDuplicateResolutions[group.key];
            if (resolution?.action === 'skip') return count;
            if (resolution?.action === 'merge') return count + 1;
            return count + 1;
          }, 0)}</p>
          <p>Records to be skipped: {csvDuplicates.reduce((count, group) => {
            const resolution = csvDuplicateResolutions[group.key];
            if (resolution?.action === 'skip') return count + group.records.length;
            if (resolution?.action === 'merge') return count + group.records.length - 1;
            return count + group.records.length - 1;
          }, 0)}</p>
        </div>
      </Card>
    </div>
  );

  const renderStepContent = () => {
    switch (step) {
      case "upload":
        return (
          <div className="space-y-4">
            {/* <Button onClick={downloadTestCSV} variant="outline">
              Download Test CSV
            </Button> */}
            <div>
              <Input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                ref={fileInputRef}
                className="sr-only"
                id="csv-file"
              />
              <Button onClick={() => fileInputRef.current?.click()}>
                {file ? "Change File" : "Select CSV File"}
              </Button>
              {file && <span className="ml-2">{file.name}</span>}
            </div>
          </div>
        );
      case "mapping":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Map CSV Columns</h3>
            <div className="grid gap-4">
              {headers.map((header) => {
                // Try to find an exact match in available fields
                const exactMatch = availableFields.find(
                  field => field.label.toLowerCase() === header.toLowerCase()
                );
                
                // If no exact match found, default to custom field
                const defaultValue = exactMatch ? exactMatch.value : `custom_${header}`;
                
                // Find if this header is already mapped to a field
                const mappedTo = Object.entries(mappings).find(
                  ([_, value]) => value === header
                )?.[0] || defaultValue;

                return (
                  <div key={header} className="flex items-center space-x-2">
                    <Label className="w-1/3">{header}</Label>
                    <Select
                      defaultValue={mappedTo}
                      onValueChange={(value) =>
                        handleMappingChange(header, value)
                      }
                    >
                      <SelectTrigger
                        className={cn(
                          "w-2/3",
                          mappedTo?.startsWith('custom_') ? "border-blue-500 bg-blue-50" : 
                          mappedTo ? "border-green-500" : ""
                        )}
                      >
                        <SelectValue placeholder="Select field" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableFields.map((field) => (
                          <SelectItem 
                            key={field.value} 
                            value={field.value}
                          >
                            {field.label}
                          </SelectItem>
                        ))}
                        <SelectSeparator />
                        <SelectItem 
                          key={`custom_${header}`}
                          value={`custom_${header}`}
                          className="text-blue-600 font-medium bg-blue-50"
                        >
                          ✨ Use as custom field
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>
        );
      case "validation":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Correct Invalid Data</h3>
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
                {invalidData.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Input
                        value={row[mappings["appName"]]}
                        onChange={(e) =>
                          handleDataCorrection(index, "appName", e.target.value)
                        }
                        className={cn(row.errors?.appName && "border-red-500")}
                      />
                      {row.errors?.appName && (
                        <p className="text-red-500 text-sm mt-1">
                          {row.errors.appName}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row[mappings["appId"]]}
                        onChange={(e) =>
                          handleDataCorrection(index, "appId", e.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row[mappings["developer"]]}
                        onChange={(e) =>
                          handleDataCorrection(
                            index,
                            "developer",
                            e.target.value
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row[mappings["category"]]}
                        onChange={(e) =>
                          handleDataCorrection(
                            index,
                            "category",
                            e.target.value
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      case "csvDuplicates":
        return renderCsvDuplicatesStep();
      case "duplicates":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Potential Duplicates</h3>
            {isLoading ? (
              <div className="flex justify-center items-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2">Checking for duplicates...</span>
              </div>
            ) : duplicates.length === 0 ? (
              <div className="text-center py-4">
                <p>No duplicates found. Ready to import!</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">
                  The following records in your CSV file have potential matches
                  in Airtable. Review and select how to handle each duplicate.
                </p>
                {duplicates.map((duplicate, index) => (
                  <Card key={index} className="p-4">
                    <div className="flex flex-col space-y-2">
                      <h4 className="font-semibold">
                        {duplicate.importData.appName}
                      </h4>
                      <div className="bg-blue-50 p-2 rounded text-sm">
                        <p className="font-medium">
                          Matched on: {duplicate.matchedOn.join(", ")}
                        </p>
                      </div>

                      {/* Show each duplicate match */}
                      {duplicate.duplicates.map((existingRecord: { 
                        id: string;
                        appName: string;
                        appId: string;
                        developer: string;
                        category: string;
                        companyWebsite?: string;
                        companyLinkedinUrl?: string;
                        sensorTowerId?: string;
                        googlePlayId?: string;
                        developerId?: string;
                        campaignIds?: string[];
                      }) => (
                        <div key={existingRecord.id} className="mt-4">
                          <div className="mb-2">
                            <RadioGroup
                              defaultValue="keep"
                              value={duplicateResolutions[existingRecord.id]?.action || "keep"}
                              onValueChange={(value: string) =>
                                handleDuplicateResolution(
                                  existingRecord.id,
                                  value as "keep" | "replace" | "merge"
                                )
                              }
                              className="flex space-x-4"
                            >
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="keep" id={`keep-${existingRecord.id}`} />
                                <Label htmlFor={`keep-${existingRecord.id}`}>
                                  Keep existing record
                                </Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem
                                  value="replace"
                                  id={`replace-${existingRecord.id}`}
                                />
                                <Label htmlFor={`replace-${existingRecord.id}`}>
                                  Use imported data
                                </Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="merge" id={`merge-${existingRecord.id}`} />
                                <Label htmlFor={`merge-${existingRecord.id}`}>
                                  Merge records
                                </Label>
                              </div>
                            </RadioGroup>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className={cn(
                              "p-3 rounded",
                              duplicateResolutions[existingRecord.id]?.action === "keep"
                                ? "bg-green-50 border border-green-200"
                                : "bg-gray-50"
                            )}>
                              <p className="text-sm font-medium text-gray-500">
                                Existing Record in Airtable
                              </p>
                              <p>App Name: {existingRecord.appName}</p>
                              <p>App ID: {existingRecord.appId}</p>
                              <p>Developer: {existingRecord.developer}</p>
                              <p>Category: {existingRecord.category}</p>
                              {existingRecord.companyWebsite && (
                                <p>Website: {existingRecord.companyWebsite}</p>
                              )}
                              {existingRecord.companyLinkedinUrl && (
                                <p>LinkedIn: {existingRecord.companyLinkedinUrl}</p>
                              )}
                              {existingRecord.sensorTowerId && (
                                <p>Sensor Tower ID: {existingRecord.sensorTowerId}</p>
                              )}
                              {existingRecord.googlePlayId && (
                                <p>Google Play ID: {existingRecord.googlePlayId}</p>
                              )}
                              {existingRecord.developerId && (
                                <p>Developer ID: {existingRecord.developerId}</p>
                              )}
                              {existingRecord.campaignIds && existingRecord.campaignIds.length > 0 && (
                                <p>Campaign IDs: {existingRecord.campaignIds.join(", ")}</p>
                              )}
                            </div>
                            <div className={cn(
                              "p-3 rounded",
                              duplicateResolutions[existingRecord.id]?.action === "replace"
                                ? "bg-green-50 border border-green-200"
                                : "bg-blue-50"
                            )}>
                              <p className="text-sm font-medium text-blue-500">
                                Record from CSV
                              </p>
                              <p>App Name: {duplicate.importData.appName}</p>
                              <p>App ID: {duplicate.importData.appId}</p>
                              <p>Developer: {duplicate.importData.developer}</p>
                              <p>Category: {duplicate.importData.category}</p>
                              {duplicate.importData.companyWebsite && (
                                <p>Website: {duplicate.importData.companyWebsite}</p>
                              )}
                              {duplicate.importData.companyLinkedinUrl && (
                                <p>LinkedIn: {duplicate.importData.companyLinkedinUrl}</p>
                              )}
                              {duplicate.importData.sensorTowerId && (
                                <p>Sensor Tower ID: {duplicate.importData.sensorTowerId}</p>
                              )}
                              {duplicate.importData.googlePlayId && (
                                <p>Google Play ID: {duplicate.importData.googlePlayId}</p>
                              )}
                              {duplicate.importData.developerId && (
                                <p>Developer ID: {duplicate.importData.developerId}</p>
                              )}
                            </div>
                          </div>

                          {duplicateResolutions[existingRecord.id]?.action === "merge" && (
                            <div className="mt-4 p-4 bg-green-50 rounded border border-green-200">
                              <h5 className="font-medium mb-2">Field Selection for Merge</h5>
                              <div className="space-y-2">
                                {Object.keys(airtableMatchFields).map((field) => (
                                  <div key={field} className="flex items-center justify-between">
                                    <span className="font-medium">{field}:</span>
                                    <RadioGroup
                                      value={duplicateResolutions[existingRecord.id]?.fieldResolutions[field] || "existing"}
                                      onValueChange={(value: FieldResolution) =>
                                        handleFieldResolution(existingRecord.id, field, value)
                                      }
                                      className="flex space-x-4"
                                    >
                                      <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="existing" id={`existing-${existingRecord.id}-${field}`} />
                                        <Label htmlFor={`existing-${existingRecord.id}-${field}`}>
                                          {existingRecord[field as keyof typeof existingRecord] || "(empty)"}
                                        </Label>
                                      </div>
                                      <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="imported" id={`imported-${existingRecord.id}-${field}`} />
                                        <Label htmlFor={`imported-${existingRecord.id}-${field}`}>
                                          {duplicate.importData[field as keyof typeof duplicate.importData] || "(empty)"}
                                        </Label>
                                      </div>
                                    </RadioGroup>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </>
            )}
          </div>
        );
      case "import":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Import Status</h3>
            {!importResult.success && !importResult.message ? (
              <div className="text-center py-4">
                <p>Click "Complete Import" to start the import process.</p>
              </div>
            ) : (
              <div
                className={cn(
                  "p-4 mt-4 rounded",
                  importResult.success ? "bg-green-50" : "bg-red-50"
                )}
              >
                <h4 className="font-semibold">Import Results</h4>
                <p>{importResult.message}</p>
                {importResult.analyzed !== undefined && (
                  <p>Records analyzed: {importResult.analyzed}</p>
                )}
                {importResult.duplicatesFound !== undefined && (
                  <p>Duplicates found: {importResult.duplicatesFound}</p>
                )}
                {importResult.webhookSuccess && (
                  <div className="flex items-center mt-2 text-green-600">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    <p>Data successfully sent to webhook</p>
                  </div>
                )}
                {importResult.errors && importResult.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold">Errors:</p>
                    <ul className="list-disc pl-5">
                      {importResult.errors.map((error, index) => (
                        <li key={index} className="text-sm text-red-600">
                          {error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  // Update the handleMatchFieldChange function
  const handleMatchFieldChange = (field: string, checked: boolean | "indeterminate") => {
    console.log("Changing match field:", field, "to:", checked);
    setDuplicateMatchFields(prev => {
      const newState = {
        ...prev,
        [field]: checked === true
      };
      console.log("New duplicate match fields state:", newState);
      return newState;
    });
  };

  // Move the availableFields state inside the component
  const [availableFields, setAvailableFields] = useState<AvailableField[]>([
    { value: "appName", label: "App Name" },
    { value: "appId", label: "App ID" },
    { value: "developer", label: "Developer" },
    { value: "category", label: "Category" },
    { value: "country", label: "Country" },
    { value: "companyWebsite", label: "Company Website" },
    { value: "companyLinkedinUrl", label: "Company LinkedIn URL" },
    { value: "sensorTowerId", label: "Sensor Tower ID" },
    { value: "googlePlayId", label: "Google Play ID" },
    { value: "developerId", label: "Developer ID" },
  ]);

  return (
    <>
      <Card className="w-full max-w-6xl">
        <CardHeader className="space-y-6 border-b-0">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>CSV Analysis</CardTitle>
              <CardDescription>
                Analyze your CSV file for potential duplicates
              </CardDescription>
            </div>
            
            <div className="flex space-x-2">
              {step !== "upload" && (
                <Button
                  variant="outline"
                  onClick={() => {
                    switch (step) {
                      case "mapping":
                        setStep("upload");
                        break;
                      case "csvDuplicates":
                        setStep("mapping");
                        break;
                      case "validation":
                        setStep("csvDuplicates");
                        break;
                      case "duplicates":
                        setStep("validation");
                        break;
                      case "import":
                        setStep("duplicates");
                        break;
                    }
                  }}
                  disabled={isLoading}
                >
                  Back
                </Button>
              )}
              
              <Button
                onClick={handleNextStep}
                disabled={
                  (step === "upload" && !file) ||
                  (step === "mapping" && !mappings["appName"]) ||
                  isLoading
                }
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {step === "import" ? "Importing..." : "Loading..."}
                  </>
                ) : step === "import" ? (
                  "Complete Import"
                ) : (
                  "Next"
                )}
              </Button>
            </div>
          </div>
          
          {/* Redesigned progress indicator */}
          <div className="mt-8 mb-2">
            {/* Step progress bar */}
            <div className="relative mb-12">
              {/* Background track */}
              <div className="absolute top-3 left-0 right-0 h-1 bg-gray-200" />
              
              {/* Filled track */}
              <div 
                className="absolute top-3 left-0 h-1 bg-primary transition-all duration-300"
                style={{
                  width: step === "upload" ? "0%" : 
                         step === "mapping" ? "20%" : 
                         step === "csvDuplicates" ? "40%" : 
                         step === "validation" ? "60%" : 
                         step === "duplicates" ? "80%" : "100%"
                }}
              />
              
              {/* Step dots */}
              <div className="relative flex justify-between">
                <StepDot 
                  label="Upload" 
                  active={step === "upload"} 
                  completed={step !== "upload"} 
                />
                <StepDot 
                  label="Mapping" 
                  active={step === "mapping"} 
                  completed={["csvDuplicates", "validation", "duplicates", "import"].includes(step)} 
                />
                <StepDot 
                  label="CSV Duplicates" 
                  active={step === "csvDuplicates"} 
                  completed={["validation", "duplicates", "import"].includes(step)} 
                />
                <StepDot 
                  label="Validation" 
                  active={step === "validation"} 
                  completed={["duplicates", "import"].includes(step)} 
                />
                <StepDot 
                  label="Airtable Duplicates" 
                  active={step === "duplicates"} 
                  completed={step === "import"} 
                />
                <StepDot 
                  label="Import" 
                  active={step === "import"} 
                  completed={false} 
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {renderStepContent()}
        </CardContent>
      </Card>
      <Toaster position="top-right" />
    </>
  );
}