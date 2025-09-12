# vscode-polarion README

This extension finds work items in polarion and add the title of the work item behind the item ID in any text. These texts are decorations in Code and do not interfere with the document itself.

A document will be updated on save or when changes the file that is viewed in Code.

**Note: This extension now uses the Polarion REST API instead of SOAP/WSDL for improved performance and reliability.**

## Features

After setup after any save expect the titles to be displayed like depicted below:

![Example](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/example1.jpg?raw=true)

Hover over the text behind the line or on the item for a hover with more detailed info:

![Hover info](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/hover.JPG?raw=true)

Right click on a work item name will enable the 'Open item in Polarion' option in this context menu.

![Context menu](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/context_menu.jpg?raw=true)

Use the outline to quickly navigate to work items in the currently opened document.

![Context menu](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/outline.jpg?raw=true)

Look for the messages that pop-up:

![Logged in](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/success.jpg?raw=true)

![Misconfiguration](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/warning.jpg?raw=true)

![Error](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/error.jpg?raw=true)

General information is always available in the status bar. which can be clicked to restart the polarion client.

![Status logged in](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/bar1.jpg?raw=true)
![Status updating document](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/bar2.jpg?raw=true)

More detailed info is printed in a newly added output channel:

![Polarion output](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/output.jpg?raw=true)

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `Polarion.Url`: The polarion url, f.e.: http://polarion2020.example.com/polarion
* `Polarion.Project`: The polarion project ID
* `Polarion.Prefix`: The ticket prefix without the -
* `Polarion.UseTokenAuth`: Use token authentication (default: true)
* `Polarion.Token`: Polarion authentication token for REST API access
* `Polarion.Username`: The polarion username to log in (only used when UseTokenAuth is false)
* `Polarion.Password`: The password for that user (only used when UseTokenAuth is false)
* `Polarion.Color`: The color for the texts that are added
* `Polarion.Hover`: Enables the hover menu
* `Polarion.RefreshTime`: Time after which an item in cache is refreshed

## Authentication

### Token Authentication (Recommended)
The extension now uses Polarion's REST API with token-based authentication. Store your Polarion access token in the VS Code settings under `Polarion.Token`. 

To generate a token in Polarion:
1. Log into your Polarion instance
2. Go to your user profile settings
3. Navigate to the "Access Tokens" section
4. Generate a new token with appropriate permissions
5. Copy the token to the `Polarion.Token` setting in VS Code

### Username/Password Authentication (Legacy)
Basic authentication is still supported for backwards compatibility. The username and password can be saved in VS Code settings or in a separate file in .vscode with the name polarion.json. If the file is present and valid, it will override the settings above.
![polarion config file](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/config.png?raw=true)

## Migration from SOAP to REST API

This version migrates from SOAP/WSDL to Polarion's REST API v1 for:
- Better performance and reliability
- Modern HTTP-based communication
- Improved error handling
- Reduced dependencies

The API endpoints used:
- `GET /polarion/rest/v1/projects` - Connection testing
- `GET /polarion/rest/v1/projects/{project}/workitems/{id}` - Fetch work items

## Known Issues

Password is stored in plain text in settings.

Only the first work item is handled:

![Example](https://github.com/jesper-raemaekers/vscode-polarion/blob/main/images/limitation1.jpg?raw=true)

## Release Notes

### 0.3.0 (Upcoming)

**BREAKING CHANGE**: Migrated from SOAP/WSDL to Polarion REST API v1
- Improved performance and reliability
- Better error handling and authentication
- Removed dependency on SOAP library
- Added support for modern token-based authentication
- REST API endpoints replace WSDL services

### 0.2.2

Added the refresh time setting and polarion.json configuration file.

### 0.2.1

Added time to workitem so they are retrieved again after a period of time. This helps when updating tickets or after a disconenction from polarion.

### 0.2.0

Initial test command added for getting the work item title

### 0.1.8

Added outline view.

### 0.1.7

Added hover menu with more work item info.

### 0.1.6

Added output channel for more detailed logs that are user accesible.

### 0.1.5

Added status bar item showing update progress. Nice for larger documents or slower servers.

### 0.1.4

Adding logo

### 0.1.1

Add editor context menu option. some error reporting in place.

### 0.0.1

Initial release with basic functionality and no tests

