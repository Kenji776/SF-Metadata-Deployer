- What is this?

This is a node.js application for importing Salesforce custom metadata records created from a CSV file. It dramatically simplifies the metadata import/creation process.

- Why does it exist? What problem does it solve?

Salesforce by default does not provide any utility for importing custom metadata records. When moving from org to org or simply generating initial data it can be painful to try and create/deploy those records. The utility allows you to easily export your metadata from one org or create new and get it into your desired org without as little pain as possible.

- How do I use it?

You simply place your CSV files in the 'sourceDir', configure the rest of the parameters as needed in the config.json, put this application folder somewhere inside your Salesforce 

- What exactly, step by step does it do?

The functional steps the script performs are as follows
1) Reads each .csv file from the folder specified in the config.json
2) For each source file it may optionally remove the 'label' column that is automatically generated if your file came from an export as this column will cause errors during metadata generation.
3) For each source file it may optionally rename the 'DeveloperName' column that is automatically generated if your file came from an export and rename it to 'Name' as this is what is expected.
4) Saves a copy of the modified source files into the 'destDir' directory.
5) Optionally downloads the definition data of the metadata objects which is required to exist for the generation step.
6) Generates the importable metadata records using SFDX
7) Optionally genereates package.xml file(s) that will deploy the generated content.
8) Deploys the package.xml files.


	

Ideas
- Possible feature to automatically update with missing picklist values?
- Autostrip Undefined

    <values>
        <field>undefined</field>
        <value xsi:type="xsd:string">undefined</value>
    </values>
