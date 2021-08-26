<?php
	
	require '/home/tom/money/push_database.php';
	//Set directory
	$dir = "/home/tom/money/payslips/";
	$debug = 0;

	//Scan directory
	$files = scandir($dir);

	echo print_r($files);
	foreach ($files as $key => $value) {
		if( preg_match("/.pdf/", $value ) ) {
			//This is a PDF
			//Ideally should check the PDF but currently just runs all PDF Files
			echo "INFO: Running PaySlip Parser for file: $dir/$value\n";
			push_to_database($dir . "/" . $value, $debug);
		}
	}


?>
