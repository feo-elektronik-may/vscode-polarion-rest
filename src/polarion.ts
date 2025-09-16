import axios, { AxiosInstance, AxiosResponse } from "axios";
import * as vscode from 'vscode';
import * as utils from './utils';
import * as editor from './editor';

export let polarion: Polarion;

// Event emitter for Polarion connection state changes
export const onPolarionConnectionChanged = new vscode.EventEmitter<boolean>();

export interface PolarionWorkItem {
  id: string;
  title: string;
  type: {
    id: string;
    name?: string; // Display name from workitem type enumeration API
    iconPath?: string; // Local path to downloaded icon
  };
  author: {
    id: string;
    name?: string; // Display name from user API
    email?: string; // Email from user API
    initials?: string; // Initials from user API
  };
  status: {
    id: string;
    name?: string; // Display name from API
    color?: string; // Color from API
    iconPath?: string; // Local path to downloaded icon
  };
  description?: {
    content: string;
  };
  attributes?: {
    unresolvable?: string;
  };
  project: {
    id: string;
  };
  
  // Method to download attachments for this workitem
  downloadAttachment(attachmentId: string): Promise<string | null>;
}

export class Polarion {
  // HTTP client
  httpClient: AxiosInstance;

  //polarion config
  polarionUser: string;
  polarionPassword: string;
  polarionUrl: string;
  useTokenAuth: boolean;
  polarionToken: string | null;

  //initialized boolean
  initialized: boolean;

  //authentication headers
  authHeaders: any;

  //message related
  numberOfPopupsToShow: number;
  lastMessage: string | undefined;
  outputChannel: vscode.OutputChannel;

  //cache
  itemCache: Map<string, { workitem: any, time: Date }>;
  attachmentCache: Map<string, string>; // Cache for attachment base64 data
  statusCache: Map<string, { statuses: Map<string, { name: string, color: string, iconPath?: string }>, time: Date }>; // Cache for project+type status mappings
  workitemTypeCache: Map<string, { types: Map<string, { name: string, iconPath?: string }>, time: Date }>; // Cache for project workitem type mappings
  iconCache: Map<string, string>; // Cache for downloaded status icons (iconURL -> local path)
  userCache: Map<string, { user: { name: string, email?: string, initials?: string }, time: Date }>; // Cache for user information

  //exception handling
  exceptionCount: number;

  constructor(url: string, username: string, password: string, useTokenAuth: boolean, outputChannel: vscode.OutputChannel) {
    this.polarionUser = username;
    this.polarionPassword = password;
    this.polarionUrl = url;
    this.useTokenAuth = useTokenAuth;
    this.polarionToken = null;
    this.initialized = false;
    this.authHeaders = {};
    this.numberOfPopupsToShow = 2;
    this.lastMessage = undefined;
    this.outputChannel = outputChannel;
    this.itemCache = new Map<string, { workitem: any, time: Date }>();
    this.attachmentCache = new Map<string, string>();
    this.statusCache = new Map<string, { statuses: Map<string, { name: string, color: string, iconPath?: string }>, time: Date }>();
    this.workitemTypeCache = new Map<string, { types: Map<string, { name: string, iconPath?: string }>, time: Date }>();
    this.iconCache = new Map<string, string>();
    this.userCache = new Map<string, { user: { name: string, email?: string, initials?: string }, time: Date }>();
    this.exceptionCount = 0;

    this.report(`Polarion service started`, LogLevel.info);
    this.report(`With url: ${this.polarionUrl}`, LogLevel.info);
    if (this.useTokenAuth) {
      this.report(`Using token authentication from VS Code settings`, LogLevel.info);
    } else {
      this.report(`With user: ${this.polarionUser}`, LogLevel.info);
    }

    // Create axios instance for REST API calls
    this.httpClient = axios.create({
      baseURL: url,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  async initialize() {
    try {
      // If using token auth, retrieve the token from VS Code settings
      if (this.useTokenAuth) {
        await this.retrieveTokenFromSettings();
      }

      // Setup authentication
      await this.setupAuthentication();
      
      // Test the connection by making a simple API call
      await this.testConnection();
      
      this.initialized = true;
      this.report(`Polarion REST API connection established`, LogLevel.info, true);
      
      // Fire event when Polarion becomes connected
      onPolarionConnectionChanged.fire(true);
    } catch (error) {
      this.report(`Failed to initialize Polarion REST API: ${error}`, LogLevel.error, true);
      this.initialized = false;
      
      // Fire event when Polarion connection fails
      onPolarionConnectionChanged.fire(false);
    }
  }

  private async retrieveTokenFromSettings(): Promise<void> {
    try {
      const token: string | undefined = vscode.workspace.getConfiguration('Polarion', null).get('Token');
      this.polarionToken = token || null;
      if (this.polarionToken && this.polarionToken.trim() !== '') {
        this.report(`Token retrieved successfully from VS Code settings`, LogLevel.info);
      } else {
        this.report(`No token found in VS Code settings (Polarion.Token)`, LogLevel.error, true);
      }
    } catch (error) {
      this.report(`Failed to retrieve token from VS Code settings: ${error}`, LogLevel.error, true);
    }
  }

  private async setupAuthentication(): Promise<void> {
    if (this.useTokenAuth && this.polarionToken && this.polarionToken.trim() !== '') {
      // Token-based authentication using Bearer token
      this.authHeaders = {
        'Authorization': `Bearer ${this.polarionToken}`
      };
      this.report(`Using token authentication`, LogLevel.info);
    } else if (!this.useTokenAuth && this.polarionUser && this.polarionPassword) {
      // Basic authentication
      const credentials = Buffer.from(`${this.polarionUser}:${this.polarionPassword}`).toString('base64');
      this.authHeaders = {
        'Authorization': `Basic ${credentials}`
      };
      this.report(`Using basic authentication`, LogLevel.info);
    } else {
      throw new Error('No valid authentication method configured');
    }

    // Set default headers for all requests
    this.httpClient.defaults.headers.common = {
      ...this.httpClient.defaults.headers.common,
      ...this.authHeaders
    };
  }

  private async testConnection(): Promise<void> {
    try {
      // Test connection with a simple API call to get current user info
      const response = await this.httpClient.get('/polarion/rest/v1/projects');
      if (response.status === 200) {
        this.report(`REST API connection test successful`, LogLevel.info);
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error('Authentication failed - check your credentials');
      } else if (error.response?.status === 403) {
        throw new Error('Access forbidden - check your permissions');
      } else {
        throw new Error(`Connection test failed: ${error.message}`);
      }
    }
  }

  async getWorkItem(workItem: string): Promise<any | undefined> {
    let fetchItem = false;

    if (this.initialized) {
      if (!this.itemCache.has(workItem)) {
        fetchItem = true;
      }
      if (this.itemCache.has(workItem)) {
        let item = this.itemCache.get(workItem);
        if (item) {
          let current = new Date();
          let delta = Math.abs(current.valueOf() - item.time.valueOf());
          let minutes: number | undefined = vscode.workspace.getConfiguration('Polarion', null).get('RefreshTime');
          if (minutes) {
            if (delta > (minutes * 60 * 1000)) {
              fetchItem = true;
            }
          }
        }
      }
    }

    if (fetchItem) {
      await this.getWorkItemFromPolarion(workItem).then((item: any | undefined) => {
        // Also add undefined workItems to avoid looking them up more than once
        this.itemCache.set(workItem, { workitem: item, time: new Date() });
      });
    }

    //lookup in dictionary
    var item = undefined;
    if (this.itemCache.has(workItem)) {
      item = this.itemCache.get(workItem);
    }
    return item?.workitem;
  }

  private async getWorkItemFromPolarion(itemId: string): Promise<PolarionWorkItem | undefined> {
    // don't bother requesting if not initialized
    if (this.initialized === false) {
      return undefined;
    }

    try {
      this.report(`Fetching work item ${itemId} via REST API`, LogLevel.info);
      
      // Use Polarion REST API v1 to get work item from all projects
      const response: AxiosResponse = await this.httpClient.get(
        `/polarion/rest/v1/all/workitems`,
        { params: {
          "query": `id:${itemId}`,
          "fields[workitems]": "id,title,type,author,status,description,project"
        }}
      );

      if (response.status === 200 && response.data?.data?.length > 0) {
        const workItem = response.data.data[0]; // Get the first (and should be only) result
        this.report(`getWorkItem: Found workitem ${itemId} ${workItem.attributes?.title || workItem.title || 'No title'}`, LogLevel.info);
        
        // Transform REST API response to match the expected format
        const attributes = workItem.attributes || workItem;
        const projectId = workItem.relationships?.project?.data?.id || attributes.project || 'unknown';
        const statusId = attributes.status || workItem.status || 'unknown';
        const workitemType = attributes.type || workItem.type || 'unknown';
        
        // Get status display info (name, color, icon)
        const statusInfo = await this.getStatusDisplayInfo(statusId, projectId, workitemType);
        
        // Get workitem type display info (name, icon)
        const typeInfo = await this.getWorkitemTypeDisplayInfo(workitemType, projectId);
        
        // Get author display info (name, email, initials)
        const authorId = workItem.relationships?.author?.data?.id || workItem.author?.id || 'unknown';
        const authorInfo = await this.getUserDisplayInfo(authorId);
        
        return {
          id: workItem.id || attributes.id,
          title: attributes.title || 'No title',
          type: {
            id: workitemType,
            name: typeInfo.name,
            iconPath: typeInfo.iconPath
          },
          author: {
            id: authorId,
            name: authorInfo.name,
            email: authorInfo.email,
            initials: authorInfo.initials
          },
          status: {
            id: statusId,
            name: statusInfo.name,
            color: statusInfo.color,
            iconPath: statusInfo.iconPath
          },
          description: attributes.description ? {
            content: attributes.description.value || attributes.description
          } : workItem.description ? {
            content: workItem.description.value || workItem.description
          } : undefined,
          attributes: {
            unresolvable: 'false'
          },
          project: {
            id: projectId
          },
          downloadAttachment: async (attachmentId: string): Promise<string | null> => {
            return this.downloadWorkitemAttachmentForProject(itemId, attachmentId, projectId);
          }
        };
      } else {
        this.report(`getWorkItem: Could not find workitem ${itemId}`, LogLevel.info);
        return undefined;
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        this.report(`getWorkItem: Work item ${itemId} not found`, LogLevel.info);
      } else if (error.response?.status === 401 || error.response?.status === 403) {
        this.report(`getWorkItem: Authentication/authorization error for ${itemId}`, LogLevel.error);
      } else {
        this.report(`getWorkItem: Could not fetch ${itemId} with exception: ${error.message}`, LogLevel.error);
        
        //restart instance because getting exceptions is not normal
        let exceptionLimit: number | undefined = vscode.workspace.getConfiguration('Polarion', null).get('ExceptionRestart');
        if (exceptionLimit) {
          if (this.exceptionCount > exceptionLimit && exceptionLimit > 0) {
            this.report(`getWorkItem: Restarting Polarion after ${this.exceptionCount} exceptions`, LogLevel.error);
            createPolarion(this.outputChannel);
          } else {
            this.exceptionCount++;
          }
        }
      }
      return undefined;
    }
  }

  async getTitleFromWorkItem(itemId: string): Promise<string | undefined> {
    let workItem = await this.getWorkItem(itemId);

    if (workItem) {
      return workItem.title;
    }
    else {
      return undefined;
    }
  }

  async getUrlFromWorkItem(itemId: string): Promise<string | undefined> {
    // Get the workitem to access its project information
    let workItem = await this.getWorkItem(itemId);
    
    if (!workItem) {
      return undefined;
    }

    // Construct the URL for the Polarion web interface using the workitem's project
    let baseUrl = this.polarionUrl;
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }
    // Remove /polarion from the end if it's already there to avoid duplication
    if (baseUrl.endsWith('/polarion/')) {
      baseUrl = baseUrl.slice(0, -10); // Remove '/polarion/'
    }
    return baseUrl.concat('polarion/#/project/', workItem.project.id, '/workitem?id=', itemId);
  }

  private report(msg: string, level: LogLevel, popup: boolean = false) {
    this.outputChannel.appendLine(msg);

    if (popup && this.numberOfPopupsToShow > 0) {
      this.numberOfPopupsToShow--;
      this.lastMessage = msg; // only show important messages
      switch (level) {
        case LogLevel.info:
          vscode.window.showInformationMessage(msg);
          break;
        case LogLevel.error:
          vscode.window.showErrorMessage(msg);
          break;
      }
    }
  }

  clearCache() {
    this.itemCache.clear();
    this.attachmentCache.clear();
    this.statusCache.clear();
    this.workitemTypeCache.clear();
    this.iconCache.clear();
    this.userCache.clear();
    vscode.window.showInformationMessage('Cleared polarion work item, attachment, status, workitem type, icon, and user cache');
  }

  async getStatusDisplayInfo(statusId: string, projectId: string, workitemType: string): Promise<{ name: string, color?: string, iconPath?: string }> {
    // Try to get from cache first
    const statusMap = await this.getStatusMappings(projectId, workitemType);
    const statusInfo = statusMap.get(statusId);
    if (statusInfo) {
      return statusInfo;
    }
    // Return original ID if mapping not found
    return { name: statusId };
  }

  private async getStatusMappings(projectId: string, workitemType: string): Promise<Map<string, { name: string, color: string, iconPath?: string }>> {
    if (!this.initialized) {
      return new Map<string, { name: string, color: string, iconPath?: string }>();
    }

    // Check cache first - use project+type as cache key
    const cacheKey = `${projectId}:${workitemType}`;
    let fetchStatuses = false;

    if (!this.statusCache.has(cacheKey)) {
      fetchStatuses = true;
    } else {
      const cachedData = this.statusCache.get(cacheKey);
      if (cachedData) {
        const current = new Date();
        const delta = Math.abs(current.valueOf() - cachedData.time.valueOf());
        const minutes: number | undefined = vscode.workspace.getConfiguration('Polarion', null).get('RefreshTime');
        if (minutes && delta > (minutes * 60 * 1000)) {
          fetchStatuses = true;
        }
      }
    }

    if (fetchStatuses) {
      await this.fetchStatusMappingsFromPolarion(projectId, workitemType);
    }

    const cachedData = this.statusCache.get(cacheKey);
    return cachedData ? cachedData.statuses : new Map<string, { name: string, color: string, iconPath?: string }>();
  }

  private async fetchStatusMappingsFromPolarion(projectId: string, workitemType: string): Promise<void> {
    try {
      this.report(`Fetching status mappings for project ${projectId}, type ${workitemType} via REST API`, LogLevel.info);
      
      // Use the correct API endpoint for status options per project and workitem type
      const response: AxiosResponse = await this.httpClient.get(
        `/polarion/rest/v1/projects/${projectId}/workitems/fields/status/actions/getAvailableOptions`,
        {
          params: {
            type: workitemType
          }
        }
      );

      if (response.status === 200 && response.data?.data) {
        const statusOptions = response.data.data;
        const statusMap = new Map<string, { name: string, color: string, iconPath?: string }>();

        // Process the status options
        for (const option of statusOptions) {
          if (option.id && option.name) {
            const statusInfo = {
              name: option.name,
              color: option.color || '#000000',
              iconPath: undefined as string | undefined
            };

            // Download icon if iconURL is provided
            if (option.iconURL) {
              try {
                const iconPath = await this.downloadStatusIcon(option.iconURL);
                if (iconPath) {
                  statusInfo.iconPath = iconPath;
                }
              } catch (error) {
                this.report(`Failed to download icon for status ${option.id}: ${error}`, LogLevel.info);
              }
            }

            statusMap.set(option.id, statusInfo);
          }
        }

        // Cache the results with project+type key
        const cacheKey = `${projectId}:${workitemType}`;
        this.statusCache.set(cacheKey, {
          statuses: statusMap,
          time: new Date()
        });

        this.report(`Fetched ${statusMap.size} status mappings for project ${projectId}, type ${workitemType}`, LogLevel.info);
      } else {
        this.report(`No status options data found for project ${projectId}, type ${workitemType}`, LogLevel.info);
      }
    } catch (error: any) {
      this.report(`Failed to fetch status mappings for project ${projectId}, type ${workitemType}: ${error.message}`, LogLevel.error);
      
      // Create empty cache entry to avoid repeated failed requests
      const cacheKey = `${projectId}:${workitemType}`;
      this.statusCache.set(cacheKey, {
        statuses: new Map<string, { name: string, color: string, iconPath?: string }>(),
        time: new Date()
      });
    }
  }

  private async downloadStatusIcon(iconURL: string): Promise<string | undefined> {
    try {
      // Check if icon is already cached
      if (this.iconCache.has(iconURL)) {
        return this.iconCache.get(iconURL);
      }

      // Download the icon
      const response = await this.httpClient.get(iconURL, {
        responseType: 'arraybuffer',
        headers: {
          'Accept': 'image/*'
        }
      });

      if (response.status === 200) {
        // Convert to base64 and create data URI
        const buffer = Buffer.from(response.data);
        const base64Data = buffer.toString('base64');
        
        // Determine mime type from URL extension
        const extension = iconURL.split('.').pop()?.toLowerCase();
        let mimeType = 'image/png'; // default
        if (extension === 'gif') {
          mimeType = 'image/gif';
        } else if (extension === 'jpg' || extension === 'jpeg') {
          mimeType = 'image/jpeg';
        } else if (extension === 'svg') {
          mimeType = 'image/svg+xml';
        }
        
        const dataUri = `data:${mimeType};base64,${base64Data}`;
        
        // Cache the result
        this.iconCache.set(iconURL, dataUri);
        
        return dataUri;
      }
      
      return undefined;
    } catch (error) {
      this.report(`Error downloading status icon from ${iconURL}: ${error}`, LogLevel.info);
      return undefined;
    }
  }

  async downloadWorkitemAttachmentForProject(workitemId: string, attachmentId: string, projectId: string): Promise<string | null> {
    try {
      // Check if attachment is already cached
      const cacheKey = `${workitemId}:${attachmentId}`;
      if (this.attachmentCache.has(cacheKey)) {
        return this.attachmentCache.get(cacheKey) || null;
      }

      this.report(`Downloading attachment ${attachmentId} for workitem ${workitemId}`, LogLevel.info);
      
      // Use Polarion REST API to download attachment
      const response = await this.httpClient.get(
        `/polarion/rest/v1/projects/${projectId}/workitems/${workitemId}/attachments/${attachmentId}/content`,
        {
          responseType: 'arraybuffer',
          headers: {
            'Accept': '*/*'
          }
        }
      );

      if (response.status === 200) {
        // Convert to base64
        const buffer = Buffer.from(response.data);
        const base64Data = buffer.toString('base64');
        
        // Cache the result
        this.attachmentCache.set(cacheKey, base64Data);
        
        return base64Data;
      }
      
      return null;
    } catch (error: any) {
      this.report(`Failed to download attachment ${attachmentId} for workitem ${workitemId}: ${error.message}`, LogLevel.error);
      return null;
    }
  }

  async getUserDisplayInfo(userId: string): Promise<{ name: string, email?: string, initials?: string }> {
    // Try to get from cache first
    const userInfo = await this.getUserInfo(userId);
    return userInfo;
  }

  private async getUserInfo(userId: string): Promise<{ name: string, email?: string, initials?: string }> {
    if (!this.initialized) {
      return { name: userId }; // Return original ID if not initialized
    }

    // Check cache first
    let fetchUser = false;

    if (!this.userCache.has(userId)) {
      fetchUser = true;
    } else {
      const cachedData = this.userCache.get(userId);
      if (cachedData) {
        const current = new Date();
        const delta = Math.abs(current.valueOf() - cachedData.time.valueOf());
        const minutes: number | undefined = vscode.workspace.getConfiguration('Polarion', null).get('RefreshTime');
        if (minutes && delta > (minutes * 60 * 1000)) {
          fetchUser = true;
        }
      }
    }

    if (fetchUser) {
      await this.fetchUserFromPolarion(userId);
    }

    const cachedData = this.userCache.get(userId);
    return cachedData ? cachedData.user : { name: userId };
  }

  private async fetchUserFromPolarion(userId: string): Promise<void> {
    try {
      this.report(`Fetching user info for ${userId} via REST API`, LogLevel.info);
      
      // Use the Polarion REST API to get user information
      const response: AxiosResponse = await this.httpClient.get(
        `/polarion/rest/v1/users/${userId}`,
        {
          params: {
            "fields[users]": "id,name,email,initials"
          }
        }
      );

      if (response.status === 200 && response.data?.data) {
        const userData = response.data.data;
        const attributes = userData.attributes || {};
        
        const userInfo = {
          name: attributes.name || userId,
          email: attributes.email,
          initials: attributes.initials
        };

        // Cache the results
        this.userCache.set(userId, {
          user: userInfo,
          time: new Date()
        });

        this.report(`Fetched user info for ${userId}: ${userInfo.name}`, LogLevel.info);
      } else {
        this.report(`No user data found for ${userId}`, LogLevel.info);
        
        // Cache empty result to avoid repeated failed requests
        this.userCache.set(userId, {
          user: { name: userId },
          time: new Date()
        });
      }
    } catch (error: any) {
      this.report(`Failed to fetch user info for ${userId}: ${error.message}`, LogLevel.error);
      
      // Create empty cache entry to avoid repeated failed requests
      this.userCache.set(userId, {
        user: { name: userId },
        time: new Date()
      });
    }
  }

  async getWorkitemTypeDisplayInfo(typeId: string, projectId: string): Promise<{ name: string, iconPath?: string }> {
    // Try to get from cache first
    const typeMap = await this.getWorkitemTypeMappings(projectId);
    const typeInfo = typeMap.get(typeId);
    if (typeInfo) {
      return typeInfo;
    }
    // Return original ID if mapping not found
    return { name: typeId };
  }

  private async getWorkitemTypeMappings(projectId: string): Promise<Map<string, { name: string, iconPath?: string }>> {
    if (!this.initialized) {
      return new Map<string, { name: string, iconPath?: string }>();
    }

    // Check cache first - use project as cache key
    let fetchTypes = false;

    if (!this.workitemTypeCache.has(projectId)) {
      fetchTypes = true;
    } else {
      const cachedData = this.workitemTypeCache.get(projectId);
      if (cachedData) {
        const current = new Date();
        const delta = Math.abs(current.valueOf() - cachedData.time.valueOf());
        const minutes: number | undefined = vscode.workspace.getConfiguration('Polarion', null).get('RefreshTime');
        if (minutes && delta > (minutes * 60 * 1000)) {
          fetchTypes = true;
        }
      }
    }

    if (fetchTypes) {
      await this.fetchWorkitemTypeMappingsFromPolarion(projectId);
    }

    const cachedData = this.workitemTypeCache.get(projectId);
    return cachedData ? cachedData.types : new Map<string, { name: string, iconPath?: string }>();
  }

  private async fetchWorkitemTypeMappingsFromPolarion(projectId: string): Promise<void> {
    try {
      this.report(`Fetching workitem type mappings for project ${projectId} via REST API`, LogLevel.info);
      
      // Use the Polarion REST API to get workitem type enumerations for the project
      const response: AxiosResponse = await this.httpClient.get(
        `/polarion/rest/v1/projects/${projectId}/enumerations/~/workitem-type/~`
      );

      if (response.status === 200 && response.data?.data?.attributes?.options) {
        const typeOptions = response.data.data.attributes.options;
        const typeMap = new Map<string, { name: string, iconPath?: string }>();

        // Process the workitem type options
        for (const option of typeOptions) {
          if (option.id && option.name) {
            const typeInfo = {
              name: option.name,
              iconPath: undefined as string | undefined
            };

            // Download icon if iconURL is provided
            if (option.iconURL) {
              try {
                const iconPath = await this.downloadWorkitemTypeIcon(option.iconURL);
                if (iconPath) {
                  typeInfo.iconPath = iconPath;
                }
              } catch (error) {
                this.report(`Failed to download icon for workitem type ${option.id}: ${error}`, LogLevel.info);
              }
            }

            typeMap.set(option.id, typeInfo);
          }
        }

        // Cache the results
        this.workitemTypeCache.set(projectId, {
          types: typeMap,
          time: new Date()
        });

        this.report(`Fetched ${typeMap.size} workitem type mappings for project ${projectId}`, LogLevel.info);
      } else {
        this.report(`No workitem type options data found for project ${projectId}`, LogLevel.info);
      }
    } catch (error: any) {
      this.report(`Failed to fetch workitem type mappings for project ${projectId}: ${error.message}`, LogLevel.error);
      
      // Create empty cache entry to avoid repeated failed requests
      this.workitemTypeCache.set(projectId, {
        types: new Map<string, { name: string, iconPath?: string }>(),
        time: new Date()
      });
    }
  }

  private async downloadWorkitemTypeIcon(iconURL: string): Promise<string | undefined> {
    // Reuse the same icon download logic as status icons
    return this.downloadStatusIcon(iconURL);
  }
}

enum LogLevel {
  info,
  error
}

export async function createPolarion(outputChannel: vscode.OutputChannel) {
  let polarionUrl: string | undefined = vscode.workspace.getConfiguration('Polarion', null).get('Url');
  let useTokenAuth: boolean | undefined = vscode.workspace.getConfiguration('Polarion', null).get('UseTokenAuth');
  let polarionUsername: string | undefined = vscode.workspace.getConfiguration('Polarion', null).get('Username');
  let polarionPassword: string | undefined = vscode.workspace.getConfiguration('Polarion', null).get('Password');

  // Default to token auth if not specified
  if (useTokenAuth === undefined) {
    useTokenAuth = true;
  }

  let fileConfig = utils.getPolarionConfigFromFile();
  if (fileConfig) {
    // we have a config file, override the username and password
    polarionUsername = fileConfig.username;
    polarionPassword = fileConfig.password;
    if (fileConfig.useTokenAuth !== undefined) {
      useTokenAuth = fileConfig.useTokenAuth;
    }
  }

  if (polarionUrl) {
    // For token auth, we don't need username/password to be configured
    if (useTokenAuth || (polarionUsername && polarionPassword)) {
      let newPolarion = new Polarion(polarionUrl, polarionUsername || '', polarionPassword || '', useTokenAuth, outputChannel);
      polarion = newPolarion;
      await polarion.initialize().then(() => {
        const openEditor = vscode.window.visibleTextEditors.forEach(e => {
          editor.decorate(e);
        });
      });
    } else {
      outputChannel.appendLine('Error: Username and password must be configured when token authentication is disabled');
    }
  } else {
    outputChannel.appendLine('Error: URL must be configured');
  }
}