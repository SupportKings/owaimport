'use server';

import { z } from 'zod';
import { AppRecord } from '@/lib/airtable';

// Schema for app data validation
const appItemSchema = z.object({
  appName: z.string().min(1, "App name is required"),
  appId: z.string().optional(),
  developer: z.string().optional(),
  category: z.string().optional(),
  companyWebsite: z.string().optional(),
  companyLinkedinUrl: z.string().optional(),
  sensorTowerId: z.string().optional(),
  googlePlayId: z.string().optional(),
  developerId: z.string().optional(),
  // New fields for record tracking
  recordId: z.string().optional(),
  resolutionAction: z.enum(["keep", "replace", "merge"]).optional(),
});

// Define the resolution types
type FieldResolution = "existing" | "imported" | "merged";

type DuplicateResolution = {
  action: "keep" | "replace" | "merge";
  fieldResolutions: { [field: string]: FieldResolution };
};

type ImportResult = {
  success: boolean;
  message: string;
  analyzed: number;
  duplicatesFound: number;
  errors: string[];
};

/**
 * Processes the import data for duplicate detection only (no writing to Airtable)
 * @param data - The app data to analyze
 * @param mappings - Map of column names to actual field names
 * @param duplicateResolutions - Map of record IDs with resolution actions
 * @returns Import result with analysis information
 */
export async function processImport(
  data: any[],
  mappings: { [key: string]: string },
  duplicateResolutions: Record<string, DuplicateResolution>
): Promise<ImportResult> {
  try {
    // Format the data for validation using mappings
    const formattedData = data.map(row => ({
      appName: row[mappings["appName"]] || "",
      appId: row[mappings["appId"]] || "",
      developer: row[mappings["developer"]] || "",
      category: row[mappings["category"]] || "",
      companyWebsite: row[mappings["companyWebsite"]] || "",
      companyLinkedinUrl: row[mappings["companyLinkedinUrl"]] || "",
      sensorTowerId: row[mappings["sensorTowerId"]] || "",
      googlePlayId: row[mappings["googlePlayId"]] || "",
      developerId: row[mappings["developerId"]] || "",
    }));

    // Validate each record
    const validationResults = formattedData.map((item, index) => {
      const result = appItemSchema.safeParse(item);
      if (!result.success) {
        return {
          index,
          errors: result.error.flatten(),
        };
      }
      return null;
    }).filter(Boolean);

    if (validationResults.length > 0) {
      return {
        success: false,
        message: "Validation failed for some records",
        analyzed: formattedData.length,
        duplicatesFound: 0,
        errors: validationResults.map(
          result => `Row ${(result && result.index !== undefined) ? result.index + 1 : 'Unknown'}: ${JSON.stringify(result && result.errors ? result.errors : {})}`
        ),
      };
    }
    
    // Count duplicates that were found
    const duplicatesCount = Object.keys(duplicateResolutions).length;
    
    // In a real implementation, we would process the duplicates based on the resolution actions
    // For now, we're just analyzing and not making changes to Airtable
    
    // Log the resolution actions for debugging
    console.log('Duplicate resolutions:', 
      Object.entries(duplicateResolutions).map(([id, resolution]) => ({
        id,
        action: resolution.action,
        fieldChanges: Object.entries(resolution.fieldResolutions)
          .filter(([_, value]) => value === "imported")
          .length
      }))
    );
    
    return {
      success: true,
      message: `Successfully analyzed ${formattedData.length} records. Found ${duplicatesCount} potential duplicates.`,
      analyzed: formattedData.length,
      duplicatesFound: duplicatesCount,
      errors: [],
    };
  } catch (error) {
    console.error('Import analysis error:', error);
    return {
      success: false,
      message: 'Analysis failed',
      analyzed: 0,
      duplicatesFound: 0,
      errors: [(error as Error).message],
    };
  }
} 