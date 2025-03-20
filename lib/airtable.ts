import Airtable from 'airtable';

// Initialize Airtable with API key
const initAirtable = () => {
  const apiKey = process.env.NEXT_PUBLIC_AIRTABLE_API_KEY;
  const baseId = process.env.NEXT_PUBLIC_AIRTABLE_BASE_ID;
  
  if (!apiKey || !baseId) {
    throw new Error('Airtable API key or Base ID is missing');
  }
  
  Airtable.configure({ apiKey });
  return Airtable.base(baseId);
};

// Interface for Airtable record
export interface AirtableRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  city: string;
  [key: string]: any;
}

// Interface for App record
export interface AppRecord {
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
  sequenceName?: string;
  [key: string]: any;
}

/**
 * Fetches all app records from Airtable
 * @param maxRecords - Optional maximum number of records to fetch
 * @param view - Optional view name to filter records
 * @returns Promise with array of formatted app records
 */
export async function fetchAllApps(maxRecords?: number, view?: string): Promise<AppRecord[]> {
  const base = initAirtable();
  const tableName = process.env.NEXT_PUBLIC_AIRTABLE_TABLE_NAME || 'Apps';
  
  try {
    // Configure query parameters
    const queryParams: any = {};
    
    if (view) {
      queryParams.view = view;
    }
    
    if (maxRecords) {
      queryParams.maxRecords = maxRecords;
    }
    
    // Fetch records
    const records = await base(tableName).select(queryParams).all();
    
    // Format records
    return records.map(record => ({
      id: record.id,
      appName: record.get('App Name') as string || '',
      appId: record.get('App ID') as string || '',
      developer: record.get('Developer') as string || '',
      category: record.get('Category') as string || '',
      companyWebsite: record.get('Company Website') as string || '',
      companyLinkedinUrl: record.get('Company Linkedin URL') as string || '',
      sensorTowerId: record.get('Sensor Tower ID') as string || '',
      googlePlayId: record.get('Google Play ID') as string || '',
      developerId: record.get('Developer ID') as string || '',
    }));
  } catch (error) {
    console.error('Error fetching Airtable app records:', error);
    throw error;
  }
}

/**
 * Searches for potential duplicate apps in Airtable based on matching fields
 * @param appData The app data to check for duplicates
 * @param campaignId Optional campaign ID to include in duplicate search
 * @returns Array of potential duplicate records
 */
export async function findAppDuplicates(
  appData: Partial<AppRecord>, 
  campaignId?: string
): Promise<AppRecord[]> {
  const base = initAirtable();
  const tableName = process.env.NEXT_PUBLIC_AIRTABLE_TABLE_NAME || 'Apps';

  if (!campaignId) {
    return [];
  }

  const escapeValue = (value: string) => value.replace(/'/g, "\\'");

  // Build the match conditions for each field
  const matchConditions: string[] = [];
  
  if (appData.appName) {
    matchConditions.push(`{App Name}='${escapeValue(appData.appName)}'`);
  }
  if (appData.appId) {
    matchConditions.push(`{App ID}='${escapeValue(appData.appId)}'`);
  }
  if (appData.googlePlayId) {
    matchConditions.push(`{Google Play ID}='${escapeValue(appData.googlePlayId)}'`);
  }
  if (appData.sensorTowerId) {
    matchConditions.push(`{Sensor Tower ID}='${escapeValue(appData.sensorTowerId)}'`);
  }

  // If no fields to match on, return empty array
  if (matchConditions.length === 0) {
    return [];
  }

  try {
    // Build the filter formula:
    // AND(
    //   FIND('campaignId', {Campaign ID (from Sequence Name)}),
    //   OR(
    //     {App Name}='name',
    //     {App ID}='id',
    //     {Google Play ID}='playid',
    //     {Sensor Tower ID}='towerid'
    //   )
    // )
    const campaignCondition = `FIND('${escapeValue(campaignId)}', {Campaign ID (from Sequence Name)})`;
    const matchFieldsCondition = `OR(${matchConditions.join(",")})`;
    const filterFormula = `AND(${campaignCondition},${matchFieldsCondition})`;
    
    console.log("Airtable filter formula:", filterFormula);
    
    const records = await base(tableName).select({
      filterByFormula: filterFormula
    }).all();
    
    console.log("Airtable records found:", records.length);
    
    return records.map(record => ({
      id: record.id,
      appName: record.get('App Name') as string || '',
      appId: record.get('App ID') as string || '',
      developer: record.get('Developer') as string || '',
      category: record.get('Category') as string || '',
      companyWebsite: record.get('Company Website') as string || '',
      companyLinkedinUrl: record.get('Company Linkedin URL') as string || '',
      sensorTowerId: record.get('Sensor Tower ID') as string || '',
      googlePlayId: record.get('Google Play ID') as string || '',
      developerId: record.get('Developer ID') as string || '',
      campaignIds: record.get('Campaign ID (from Sequence Name)') as string[] || [],
      sequenceName: record.get('Sequence Name') as string || '',
    }));
  } catch (error) {
    console.error("Error finding duplicates:", error);
    throw error;
  }
}

/**
 * Fetches records from Airtable
 * @param filterByEmail - Optional email to filter records
 * @returns Promise with array of formatted records
 */
export async function fetchAirtableRecords(filterByEmail?: string[]): Promise<AirtableRecord[]> {
  const base = initAirtable();
  const tableName = process.env.NEXT_PUBLIC_AIRTABLE_TABLE_NAME || 'Apps';
  
  try {
    // Build filter formula if emails are provided
    let filterFormula = '';
    if (filterByEmail && filterByEmail.length > 0) {
      const emailConditions = filterByEmail.map(email => `{Email}='${email}'`).join(',');
      filterFormula = `OR(${emailConditions})`;
    }
    
    // Configure query parameters
    const queryParams: any = {};
    
    if (filterFormula) {
      queryParams.filterByFormula = filterFormula;
    }
    
    // Fetch records
    const records = await base(tableName).select(queryParams).all();
    
    // Format records
    return records.map(record => ({
      id: record.id,
      firstName: record.get('First Name') as string || '',
      lastName: record.get('Last Name') as string || '',
      email: record.get('Email') as string || '',
      city: record.get('City') as string || '',
      // Add any other fields you need
    }));
  } catch (error) {
    console.error('Error fetching Airtable records:', error);
    throw error;
  }
}

/**
 * Checks for duplicate records in Airtable based on email
 * @param importData - Data to check for duplicates
 * @returns Promise with array of duplicate records
 */
export async function findDuplicates(importData: any[]): Promise<any[]> {
  try {
    // Extract emails from import data
    const emails = importData
      .map(item => item.email)
      .filter(Boolean);
    
    if (emails.length === 0) return [];
    
    // Fetch records that might be duplicates
    const airtableRecords = await fetchAirtableRecords(emails);
    
    // Find duplicates by comparing emails
    const duplicates = [];
    
    for (const importItem of importData) {
      const matchingRecord = airtableRecords.find(
        record => record.email.toLowerCase() === importItem.email?.toLowerCase()
      );
      
      if (matchingRecord) {
        duplicates.push({
          id: matchingRecord.id,
          name: `${importItem.firstName} ${importItem.lastName}`,
          email: importItem.email,
          existingCity: matchingRecord.city,
          newCity: importItem.city,
          // Add any other fields for comparison
          importData: importItem,
          existingData: matchingRecord
        });
      }
    }
    
    return duplicates;
  } catch (error) {
    console.error('Error finding duplicates:', error);
    throw error;
  }
} 