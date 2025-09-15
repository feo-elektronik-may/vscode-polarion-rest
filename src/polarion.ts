import axios, { AxiosInstance, AxiosResponse } from "axios";
import * as vscode from 'vscode';
import * as utils from './utils';
import * as editor from './editor';

export let polarion: Polarion;

interface PolarionWorkItem {
  id: string;
  title: string;
  type: {
    id: string;
  };
  author: {
    id: string;
  };
  status: {
    id: string;
  };
  description?: {
    content: string;
  };
  attributes?: {
    unresolvable?: string;
  };
}

export class Polarion {
  // HTTP client
  httpClient: AxiosInstance;

  //polarion config
  polarionUser: string;
  polarionPassword: string;
  polarionProject: string;
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

  //exception handling
  exceptionCount: number;

  //login state
  private loginInProgress: boolean;

  constructor(url: string, projectName: string, username: string, password: string, useTokenAuth: boolean, outputChannel: vscode.OutputChannel) {
    this.polarionUser = username;
    this.polarionPassword = password;
    this.polarionProject = projectName;
    this.polarionUrl = url;
    this.useTokenAuth = useTokenAuth;
    this.polarionToken = null;
    this.initialized = false;
    this.authHeaders = {};
    this.numberOfPopupsToShow = 2;
    this.lastMessage = undefined;
    this.outputChannel = outputChannel;
    this.itemCache = new Map<string, { workitem: any, time: Date }>();
    this.exceptionCount = 0;
    this.loginInProgress = false;

    this.report(`Polarion service started`, LogLevel.info);
    this.report(`With url: ${this.polarionUrl}`, LogLevel.info);
    this.report(`With project: ${this.polarionProject}`, LogLevel.info);
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
    } catch (error) {
      this.report(`Failed to initialize Polarion REST API: ${error}`, LogLevel.error, true);
      this.initialized = false;
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
      
      // Use Polarion REST API v1 to get work item
      const response: AxiosResponse = await this.httpClient.get(
        `/polarion/rest/v1/projects/${this.polarionProject}/workitems/${itemId}`,
        { params: {"fields[workitems]": "id,title,type,author,status,description"} }
      );

      if (response.status === 200 && response.data) {
        const workItem = response.data.data;
        this.report(`getWorkItem: Found workitem ${itemId} ${workItem.attributes?.title || workItem.title || 'No title'}`, LogLevel.info);
        
        // Transform REST API response to match the expected format
        // Check if attributes are nested under workItem.attributes or directly on workItem
        const attributes = workItem.attributes || workItem;
        
        return {
          id: workItem.id || attributes.id,
          title: attributes.title || 'No title',
          type: {
            id: attributes.type || workItem.type || 'unknown'
          },
          author: {
            id: workItem.relationships?.author?.data?.id || workItem.author?.id || 'unknown'
          },
          status: {
            id: attributes.status || workItem.status || 'unknown'
          },
          description: attributes.description ? {
            content: attributes.description.value || attributes.description
          } : workItem.description ? {
            content: workItem.description.value || workItem.description
          } : undefined,
          attributes: {
            unresolvable: 'false'
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
    // Construct the URL for the Polarion web interface
    // Ensure the URL includes /polarion in the path
    let baseUrl = this.polarionUrl;
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }
    // Remove /polarion from the end if it's already there to avoid duplication
    if (baseUrl.endsWith('/polarion/')) {
      baseUrl = baseUrl.slice(0, -10); // Remove '/polarion/'
    }
    return baseUrl.concat('polarion/#/project/', this.polarionProject, '/workitem?id=', itemId);
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
    vscode.window.showInformationMessage('Cleared polarion work item cache');
  }
}

enum LogLevel {
  info,
  error
}

export async function createPolarion(outputChannel: vscode.OutputChannel) {
  let polarionUrl: string | undefined = vscode.workspace.getConfiguration('Polarion', null).get('Url');
  let polarionProject: string | undefined = vscode.workspace.getConfiguration('Polarion', null).get('Project');
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

  if (polarionUrl && polarionProject) {
    // For token auth, we don't need username/password to be configured
    if (useTokenAuth || (polarionUsername && polarionPassword)) {
      let newPolarion = new Polarion(polarionUrl, polarionProject, polarionUsername || '', polarionPassword || '', useTokenAuth, outputChannel);
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
    outputChannel.appendLine('Error: URL and Project must be configured');
  }
}