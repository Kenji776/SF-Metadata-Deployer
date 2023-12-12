-- What is this?

This is a node.js application for importing Salesforce custom metadata records created from a CSV file. It dramatically simplifies the metadata import/creation process.

-- Why does it exist? What problem does it solve?

Salesforce by default does not provide a simple for importing custom metadata records (that I'm aware of). When moving from org to org or simply generating initial data it can be painful to try and create/deploy those records. The utility allows you to easily export your metadata from one org or create new and get it into your desired org without as little pain as possible.

-- But isn't there a metadata deployer for connected orgs? Couldn't you just download your metadata records in one org and copy/push them with SFDX into another?

In many cases yes. However, this was born our of a need to move metadata between two non connected orgs, and additionally only a subset of the metadata was wanted that would be provided via a query. Since you cannot
use SOQL in your retreive requests a different tool was needed. This allows you to use workbench (or some other utility) to craft a SOQL query to fetch only the metadata you want, export that as a CSV then import those results into another org. The default tools don't have that kind of flexibility.

-- How do I use it?

You simply place your CSV files in the 'sourceDir' (as specified in your config.json file), configure the rest of the parameters as needed in the config.json, put this application folder somewhere inside your Salesforce project folder. Install the dependencies by running the command 'npm install' from a command prompt in the application folder (folder with package.json in it). Run the metadata_deployer.bat (windows) or via command line with 'node metadata_deployer.js'. 

--Prerequisites

To use this script you must have the following.
- NodeJs installed
- Node Package Manager Installed
- A configured local Salesforce project

-- What exactly, step by step does it do?

The functional steps the script performs are as follows
1) Reads each .csv file from the folder specified in the config.json
2) For each source file it may optionally remove the 'label' column that is automatically generated if your file came from an export as this column will cause errors during metadata generation.
3) For each source file it may optionally rename the 'DeveloperName' column that is automatically generated if your file came from an export and rename it to 'Name' as this is what is expected.
4) Saves a copy of the modified source files into the 'destDir' directory.
5) Optionally downloads the definition data of the metadata objects which is required to exist for the generation step.
6) Generates the importable metadata records using SFDX
7) Optionally genereates package.xml file(s) that will deploy the generated content.
8) Deploys the package.xml files.


	
