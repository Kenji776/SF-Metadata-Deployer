/**
 * @Name SF-Metadata-Deployer
 * @Date 2/1/2023
 * @Author Daniel Llewellyn
 * @description This is a node.js application for importing Salesforce custom metadata records created from a CSV file. It dramatically simplifies the metadata import/creation process.
 */
 
const configFileName = "config.json";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { resolve } = require("path");
const CSVToJSON = require('csvtojson')
const JSONToCSVConverter = require('json-2-csv');


//entries to write into the program log on completion
let logEntries = [];

//entries to write into the program  error log on completion
let errorLogEntries = [];

//object containing cached information read from files to reduce file reads 
let cachedFileData = {}; 

//invalid translation entries as scraped from Salesforce provided error logs that are stored in the errorLogs folder. Can be added to the config.json so they don't 
//have to be recalculated on every run.
let invalidEntries = [];

//default config options
let config = {};

//Experimental UI 'loading spinner'  
var twirlTimer = (function() {
  var P = ["\\", "|", "/", "-"];
  var x = 0;
  return setInterval(function() {
    process.stdout.write('\x1b[33m\r\r\r Please Wait: ' + P[x++] + '\r\r\x1b[0m');
    x &= 3;
  }, 250);
})();

/**
* @description Entry point function.
*/
async function init() {
    console.log("                                    Salesforce Metadata Importer\r\n");
    console.log("                                     Author: Daniel Llewellyn\r\n");

    let d = new Date();
    d.toLocaleString();

    log("Started process at " + d, false);
	
	//load the configuration from the JSON file.
    let loadedConfig = loadConfig(configFileName);
    config = { ...config, ...loadedConfig };	
	
	log(`Importing data into org for username: ${config.username}. Press any key to continue or exit program`);
	
	keypress();
	
	//generate the metadata records from the csv files
	let createdMetadataRecords = await processImportFiles({
		sourceDir: config.sourceDir,
		destDir: config.destDir,
		fileType: config.importFileType
	});

	//create the package.xml files from the generated metadata records
	let packageFiles = createPackageXmlFiles({
		targetDir: config.packagesDir,
		metadataMembers:createdMetadataRecords,
		maxRowsPerPacakge: config.maxMembersPerPackage ? config.maxMembersPerPackage : 1000
	});

	//deploy the contents of the created package.xml files
	if(config.autoDeployPackage){
		let deployResults = await deployPackageFiles({
			sourceDir: config.packagesDir, 
			packageFiles: packageFiles,
			username: config.username
		});
	}else{
		log('Automatic deployment set to false. Not deploying package files',true);
	}
	finish();
}

/**
* @description Creates deployable package.xml files from an array of metadata members. Writes the generated files to the specified folder. May optionally be set to contain a maximum number of entries
* per file to help prevent deployment timeout errors.
* @todo refactor this slightly to (optionally) only put similar metadat types in the same package file instead of combining them.
* @param {string} targetDir the local folder to write the package.xml files into
* @param {array} metadataMembers array of strings, the elements to include in the package.xml file.
* @param {maxRowsPerPacakge} integer maximum number of entries to inlcude in each package.xml file.
* @return {array} array of filenames of created package.xml files.
*/
function createPackageXmlFiles({targetDir='', metadataMembers=[], maxRowsPerPacakge=1000}){
	log('Createing Package files');
	let packageFiles = [];
	//iteraete over every package member and start generating package xml files based on our max size.
	let totalProcessedMembers = 0;
	let thisPackagesMembers = [];
	let createdPackages = 0;
	for(const thisMember of metadataMembers){
		//clean its associated XML file
		fixXmlFile({
			sourceDir: `${config.projectRoot}\\customMetadata`, 
			sourceFile: thisMember
		});
		
		thisPackagesMembers.push(thisMember.replace('.md-meta.xml',''));
		totalProcessedMembers++;
	
		if(thisPackagesMembers.length >= maxRowsPerPacakge || totalProcessedMembers == metadataMembers.length){
			let filename = `package_${createdPackages}.xml`;
			
			//generate the contents of the package.xml file
			let packageXml = generatePackageXml({
				typeName: 'CustomMetadata', 
				membersArray: thisPackagesMembers
			});
			
			//write the package xml file
			fs.writeFileSync(`${targetDir}\\${filename}`, packageXml, function(err){
				if(err) {
					log(err,true,'red');
				}
			});
			
			packageFiles.push(filename);
			thisPackagesMembers = [];
			createdPackages++;
		}
	}	
	
	log('Finished creating Package files',true,'green');
	log(packageFiles);
	return packageFiles;
}


/**
* @description iterates over the import files in the given directory and sends them for cleaning. All parameters are contained in an object with each key being a param.
* @param {string} sourceDir the local folder the translation files 
* @param {string} destDir the local folder the cleaned files should be written to
* @param {string} fileType the file type filter to use to only process files of the given type. 
* @return {array} list of all custom metadata record files that were generated and can be deployed.
*/
async function processImportFiles({sourceDir='input', destDir='output', fileType='.csv'}) {
	log(`Reading ${fileType} import files from ${sourceDir}`,true);
	
	let fileNames = [];
	
	let generatedMetaDataFiles = [];
	
	try {
        let files = await getFilesOfTypeInDirectory({dir: 'input',fileType: '.csv'})
		
        // Loop them all
        for( const file of files ) {
			
			log(`Reading ${file}`,true);
			
            // Get the full paths
            const sourcePath = path.join( sourceDir, file );
            const toPath = path.join( destDir, file );

            // Stat the file to see if we have a file or dir
            const stat = await fs.promises.stat( sourcePath );

            if( stat.isFile() ){
				
				//fix up the importable file to help ensure metadata generation doesn't error. The returned importFileObject is a JSON object so any other needed changes
				//could easily be made after this
				let importfileObject = await fixImportableFile({
					sourceFile: sourcePath,
					renameDeveloperName: config.renameDeveloperNameCol,
					removeLabelCol: config.removeLabelCol
				});
				

				//TODO: Detect if definition has been pulled or not. If not, logic for getting type from JSON config or filename.
				let metadataType = file.split('.')[0];			
				
				//we want an array of all the filenames of all the generated metadata files. Since the generator command doesn't provide them we can assume that each row in our import
				//file will create a file (barring an errors). So we deduce what the filen name will be by removing the __mdt from the type name, adding in the record name and the file extension
				//which should be what the 
				for( const record of importfileObject){
					fileNames.push(metadataType.replace('__mdt','')+'.'+record.Name+'.md-meta.xml');
				}				
				
				//convert our JSON back to CSV
				let csvContent = await jsonToCsv(importfileObject);
				
				//write the CSV content back to the destination directory
				writeImportFile({
					destFolder: config.destDir, 
					fileName: file, 
					content: csvContent
				});
				
				//if we are fetching the custom metadata 	
				if(config.fetchMetadataDefinition){
					//get the metadata type definition
					let gotDefinitionResults = await getMetadataDefintion({
						metadataType: metadataType,
						forceRedownload: config.forceFetchExistingMetadata,
						username: config.username,
						projectRoot: config.projectRoot
					});
				}
				
				//generate the metadata records from the file
				let metadataGenerateResult = await generateMetadata({
					sourceFile: toPath,
					metadataType: metadataType,
					username: config.username,
					projectRoot: config.projectRoot
				});
			}
            else if( stat.isDirectory() ){
                log( sourcePath + ' is a directory. skipping. ' );
			}
        }	
    }
    catch( e ) {
        log( "Error reading source translation files to send for processing " + e.message, true, 'red' );
		if(config.pauseOnError) await keypress();
    }

	//now that we have generated all of our files. Lets get them into an array.
	
	//first find all the xml files in the folder we'd expected the generated metadata to be in.
	let allMetadataRecords = await getFilesOfTypeInDirectory({dir: `${config.projectRoot}\\customMetadata`,fileType: '.xml'});
	let importableRecords = [];
	
	//now loop over each file in our anticipated list of generated files. If it exists
	for( const file of fileNames ) {
		if(allMetadataRecords.includes(file)) importableRecords.push(file);
		else log(`Missing expected metadata file ${file}. Not found in ${config.projectRoot}\\customMetadata. Check for errors during generation`,true,'red');
	}
	
	log('Finished creating metadata records',true,'green');
	
	return importableRecords;
}

/**
* @description Performs operations on the sourceFile to fix common errors/issues that prevent generation of metadata records, such as renaming columns, removing extranious info, saving as proper encoding.
* @param {string} sourceFile the file to read and fix
* @param {boolean} renameDeveloperName if a column named 'DeveloperName' exists, should it be renamed to 'Name'?
* @param {boolean} removeLabelCol if a column named 'Label' exists, should it be removed?
* @return The cleaned/fixed CSV file as a JSON object.
*/
async function fixImportableFile({sourceFile='',renameDeveloperName=true,removeLabelCol=true}){
	log('Fixing import file: ' + sourceFile,true);
		
	let fileJSON = await readCSVFromFile(sourceFile);
	
	if(removeLabelCol) fileJSON.forEach(function(v){ delete v.Label });
	if(renameDeveloperName) fileJSON.forEach(function(v){ 
		v.Name = v.hasOwnProperty('DeveloperName') ? v.DeveloperName : 'DeveloperName Not Found';
		delete v.DeveloperName 
	});
	console.log('Cleaned ' + sourceFile,true);
	
	return fileJSON;
}

/**
* @description Performs operations on the generated custom metadata xml file to allow for deployment. Fixes the common missing/undefined node that sometimes gets created during the generation
* @param {string} sourceDir the directory containing the file to fix
* @param {string} sourceFile the file to read and fix
* @param {boolean} true if cleaning operation succeeded. False if it did not.
*/
async function fixXmlFile({sourceDir = '', sourceFile=''}){

	let badNode = `    <values>
        <field>undefined</field>
        <value xsi:type="xsd:string">undefined</value>
    </values>`;
	
	console.log(`Fixing ${sourceDir}\\${sourceFile}`);
		//read xml file
		
		//translate to JSON
		
		//look for node with field = undefined and value = undefined. Delete
		
		//convert JSON back to xml and save
	return true;
}

/**
* @description Deploys a given set of package.xml files to the org linked to the username
* @param {string} sourceDir the directory containing the package.xml files to deploy
* @param {array} packageFiles array of package.xml filenames to deploy
* @param {string} username username for the org to deploy to
* @return {boolean} true, data was fetched. false, data was not fetched
*/
async function deployPackageFiles({sourceDir='', packageFiles=[], username=''}){
	
	console.log('Deplyoing package files');
	let deployResults = [];
	
	for(const packageFile of packageFiles){	
		console.log('Deplyoing: ' + packageFile);
		let deployResult = await runCommand('sfdx force:source:deploy', [`-x "${sourceDir}\\${packageFile}"`, `-u ${username}`]);
		deployResults.push(deployResults);
		
	}
	
	log('Finished creating Package files',true,'green');
	log(deployResults,true);
		
	return deployResults;
}

/**
* @description Gets the object definition for a given custom metadata object type
* @param {string} metadataType the name of the custom metadata type to get object defintion for
* @param {string} username the username for the org to get data from
* @return {boolean} true, data was fetched. false, data was not fetched
*/
async function getMetadataDefintion({metadataType, forceRedownload=false, username, projectRoot}){
	try{
		log(`Checking for metadata definition for type ${metadataType}`,true);
		
		let metadataExists = fileExists(`${projectRoot}\\objects\\${metadataType}\\${metadataType}.object-meta.xml`) && fileExists(`${projectRoot}\\objects\\${metadataType}\\fields`);
		let doFetch = false;
		if(metadataExists){
			log(`Metadata exists in project data folder`,true);
			if(forceRedownload) doFetch = true;
		}else{
			log(`Metadata does not exist in project data folder`,true);
			doFetch = true;
		}
		
		if(doFetch){
			log(`Downloading metadata definition...`,true);
			let generateMetadataResult = await runCommand('sfdx force:source:retrieve', [`-m CustomObject:${metadataType}`, `-u ${username}`]);
			
			log(`Fetched metadata definition`);
			log(generateMetadataResult);
		
		}else{
			log(`Metadata definition exists and force redownload set to false. Skipping download.`,true);
		}		
		return true;
	}catch(ex){
		log(ex,true,'red');
		finish();
	}
	return false;
}

/**
* @description Generates importable metadata files from import file. The metadata definition must have been previously downloaded.
* @param {string} sourceFile the CSV file to generate the importable data from.
* @param {string} metadataType the name of the custom metadata type to get object defintion for
* @param {string} username the username for the org to get data from
* @return {boolean} true, data was fetched. false, data was not fetched
*/
async function generateMetadata({sourceFile, metadataType, username, projectRoot}){
	try{
		log(`Generating metadata definition for type ${metadataType}`);
		
		let generateMetadataResult = await runCommand('sfdx force:cmdt:record:insert', [`--filepath ${sourceFile}`, `--typename ${metadataType}`, `-i "${projectRoot}\\objects"`, `-d "${projectRoot}\\customMetadata"`]);
		
		log(`Generated metadata from file`);
		log(generateMetadataResult);
		return true;
	}catch(ex){
		log(ex,true,'red');
		finish();
	}
	return false;
}

/**
* @description Gets all files in a given directory with the given file type.
* @param {string} dir the local folder files are located in
* @param {string} fileType the file type filter to use to only process files of the given type. leave null or do not provide for no filtering.
*/
async function getFilesOfTypeInDirectory({dir='input',fileType=null}){
	let files = await fs.promises.readdir( dir );
	
	if(fileType){
		//filter the files to only get the types we are interested in.
		files = files.filter(file => {
			return path.extname(file).toLowerCase() === fileType;
		});
	}
	
	return files;
}

/**
* @description Generates package.xml string to be written to file
* @param {string} dir the local folder files are located in
* @param {string} fileType the file type filter to use to only process files of the given type. leave null or do not provide for no filtering.
*/
function generatePackageXml({typeName='', membersArray=[]}){
	let packageXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n '+
	'<Package xmlns="http://soap.sforce.com/2006/04/metadata">\r\n '+
		'\t<types>\r\n '+
		'\t<members>'+membersArray.join('</members>\r\n\t\t<members>')+'</members>\r\n'+
		'\t\t<name>'+typeName+'</name>\r\n'+
		'\t</types>\r\n'+
		'\t<version>58.0</version>\r\n'+
	'</Package>\r\n';

	return packageXml;
}

function writeImportFile({destFolder='output', fileName='importFile.csv', content=''}){
	try{
		fs.writeFileSync(destFolder+'\\'+fileName, content, 'utf8', function(){;
			log('Wrote file ' + destFolder + '\\' + fileName, true, 'green');
		});
	}catch(ex){
		console.log(ex);
		console.log(destFolder);
		console.log(fileName);
	}
}

/**
 * @description Parses the raw HTML content fetched by getOutboundChangeSets() to return an array containing all the change set names.
 * @param html a string of HTML that contains the change set names fetched from the Salesforce UI
 * @return
 */
function loadConfig(configFileName) {
    return readJSONFromFile(configFileName);
}

/**
 * @description Reads and parses JSON from a given file.
 * @param fileName the name of the file to read, parse, and return.
 * @return a JSON object.
 */
function readJSONFromFile(fileName) {
    let fileJSON = readFile(fileName);

	//strip any comments from our JSON sting
	fileJSON = fileJSON.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
    const parsedJSON = JSON.parse(fileJSON);
    return parsedJSON;
}

/**
 * @description Reads file from file system syncrounously
 * @param {string} fileName the name of the file to read, parse, and return.
 * @return null on error or file contents
 */
function readFile(filePath){
	log('Reading file ' + filePath,true);

	let fileData = fs.readFileSync(filePath, 'utf-8', function (err) {
		log("File not found or unreadable." + err.message, true, "red");
		return null;
	});

	log('File Found', true, 'green');
	return fileData;
}

async function jsonToCsv(jsonObject){
	const csvString = await JSONToCSVConverter.json2csv(jsonObject)
	
	return csvString;
}

async function readCSVFromFile(fileName){
	const fileData = await CSVToJSON().fromFile(fileName);
	return fileData;
}
  
/*  
async function xmlToJson(xml){
	const parser = new xml2js.Parser();
	return parser.parseStringPromise(xml);
}
*/

/**
* @description Writes XML file to the target folder with the filename with the given JSON object expressed as XML
* @param {object} jsonObject the JSON object to convert to XML and save
* @param {string} targetFolder the folder to write the XML file into
* @param {string} fileName the name of the file to write.
* @return {boolean} true if success, false if error
*/
/*
 function writeXmlFromJSON({jsonObject={}, targetFolder='output', fileName='xmlFromJson.xml'}){
	log(`Constructing XML from JSON`);
	log(jsonObject);
	
	var builder = new xml2js.Builder();
	var xml = builder.buildObject(jsonObject);

	fs.writeFileSync(`${targetFolder}\\${fileName}`, xml, function(err){
		if(err) {
			log(err);
			return false;
		}
	});
	
	log(`${targetFolder}\\${fileName} file was saved!`);
	
	return true;
}
*/

/**
 * @description Runs a shell command.
 * @param {string}  command the name of the command to execute WITHOUT any arguments.
 * @param {array} arguments an array of arguments to pass to the command.
 * @return {string} javascript promise object that contains the result of the command execution
 */
async function runCommand(command, arguments) {
	log(`Running Command ${command} ${arguments.join(' ')}`, true);
	
    let child = spawn(command, arguments, { shell: true, windowsVerbatimArguments: true });


    let data = "";
    for await (const chunk of child.stdout) {
        data += chunk;
    }
    let error = "";
    for await (const chunk of child.stderr) {
        console.error(chunk);
        error += chunk;
    }
    const exitCode = await new Promise( (resolve, reject) => {
        child.on('close', resolve);
    });

    if( exitCode) {
        throw new Error( `subprocess error exit ${exitCode}, ${error}`);
    }
    return data;
}

/**
* @description Checks if a given file exists
* @param {string} filePath the absolute or relative path of the file to confirm exists or does not
* @return {boolean} true if file exsists, false if files does not
*/
function fileExists(filePath){
	log('Looking for file ' + filePath);
	if (!fs.existsSync(filePath)) {
		log('File not found!', true, 'yellow');
		return false;
	}
	log('File Found', true, 'green');
	return true;
}

/**
* @description clears the terminal screen.
*/
function clearScreen(){
	console.log('\033[2J');
	process.stdout.write('\033c');
}

/**
 * @description Creates a log entry in the log file, and optionally displays log entry to the terminal window with requested color.
 * @param logItem a string of data to log
 * @param printToScreen boolean flag indicating if this entry should be printed to the screen (true) or only to the log file (false)
 * @param a string {'red','green','yellow'} that indicates what color the logItem should be printed in on the screen..
 */
function log(logItem, printToScreen, color) {
    printToScreen = printToScreen != null ? printToScreen : true;
    var colorCode = "";
    switch (color) {
        case "red":
            colorCode = "\x1b[31m";
            break;
        case "green":
            colorCode = "\x1b[32m";
            break;
        case "yellow":
            colorCode = "\x1b[33m";
    }

    if (printToScreen) console.log(colorCode + "" + logItem + "\x1b[0m");

	logEntries.push(logItem);
	
	if(color === 'red') errorLogEntries.push(logItem);
}

/**
* @description Prompts user to press a key
*/
const keypress = async () => {
	process.stdin.setRawMode(true);
	fs.readSync(0, Buffer.alloc(1), 0, 1);
}

/**
* @description Method that executes at the end of a script run. Writes to the log file. Exits the program.
*/
function finish() {
    log("Process completed. Writting " + logEntries.length + " log entries", true, "yellow");
	
    log("\r\n\r\n------------------------------------------------ ", false);
	
    fs.writeFileSync("log.txt", logEntries.join("\r\n"), function (err) {
        if (err) {	
			console.log('Unable to write to log file');
			console.log(err);
		}
    });
	
	if(errorLogEntries && errorLogEntries.length > 0){
		fs.writeFileSync("errors.txt", errorLogEntries.join("\r\n"), function (err) {
			if (err) {	
				console.log('Unable to write to error log file');
				console.log(err);
			}
		});
	}
	
	let d = new Date();
    d.toLocaleString();

    log("Finished process at " + d, true)
	process.exit(1);
}

/**
 * @description Method that executes on an uncaught error.
*/
process.on("uncaughtException", (err) => {
    log(err, true, "red");
	console.trace(err);
	finish();
});

init();