<?php

	/*
	PaySlip Parser
	This function aims to parse an NHS ESR-Generated Payslip into a php assoc array
	Call parse_payslip("path_to_pdf.pdf", true/false if want debugging process or not)
	--Requires PDF Parser Module
	*/
	
	include "/var/www/pay/pdfparser/alt_autoload.php-dist";

	function to_date($d) {
		$bits = explode(" ", $d);
		$dd = $bits[0];
		$yyyy = $bits[2];
		$arr = array( "JAN"=>"01","FEB"=>"02","MAR"=>"03","APR"=>"04","MAY"=>"05","JUN"=>"06","JUL"=>"07","AUG"=>"08","SEP"=>"09","OCT"=>"10","NOV"=>"11","DEC"=>"12");
		$mm = $arr[$bits[1]];
		return $yyyy . "-" . $mm . "-" . $dd;
	}

	function parse_payslip($file, $dbg = 0) {

		$parser = new \Smalot\PdfParser\Parser();
		$pdf = $parser->parseFile($file);
		$text = $pdf->getText();

		//echo "\n\n$text\n\n";

		

		$payslip = array();

		$lines = explode("\n", $text);
		if($dbg) echo count($lines) . "\n";
		$pay_allowance_titles;
		$pay_allowance_lines = array();
		$deductions_titles;
		$decuductions_totals;
		foreach($lines as $line) {
			//For each line look for the relevant information (for full payslips)
			if( preg_match("/[0-9]{7,}\t([a-zA-Z]|\.| ){0,}\t([a-zA-Z]|\.| ){0,}\tDEPARTMENT/", $line) ) {
				//Assigment / Name / Location
				if($dbg) echo "SUCCESS: Found Assignment Line\n";
				//echo $line . "\n";
				$payslip['assignment'] = preg_split("/\t/i",$line)[0];
				$payslip['name'] = preg_split("/\t/i",$line)[1];
				$payslip['location'] = preg_split("/\t/i",$line)[2];
			}
			else if( preg_match("/SAL\/WAGE\tINC./i", $line) ){
				//Dept / Title / PayScale Description
				if($dbg) echo "SUCCESS: Found Description Line:\n";
				//echo $line . "\n";
				$payslip['department'] = preg_split("/\t/i", $line)[0];
				$payslip['job_title'] = preg_split("/\t/i", $line)[1];
				$payslip['payscale_description'] = preg_split("/\t/i", $line)[2];
			}else if( preg_match("/[0-9]{2,}\.[0-9]{2}\t[0-9]{1,}([0-9])?\t[0-9]{2,}\.[0-9]{2}/", $line) ) {
				//Salary / Hours / PTSalary
				if($dbg) echo "SUCCESS: Found Salary Line:\n";
				//echo $line . "\n";
				$payslip['salary'] = preg_split("/\t/", $line)[0];
				$payslip['hours'] = preg_split("/\t/", $line)[1];
				$payslip["pt_salary"] = preg_split("/\t/", $line)[2];
			}else if( preg_match("/[0-9]{2,}\.[0-9]{2}\t[0-9]{2} [A-Z]{3} [0-9]{4}\t[0-9]{1,}([0-9])?\t[0-9]{2,}\.[0-9]{2}/", $line) ) {
				//Alt Salary / Hours / PTSalart
				if( $dbg) echo "SUCCESS: Found (alternative) Salary Line:\n";
				$payslip['salary'] = preg_split("/\t/", $line)[0];
				$payslip['hours'] = preg_split("/\t/", $line)[2];
				$payslip["pt_salary"] = preg_split("/\t/", $line)[3];
			}else if( preg_match("/\t[0-9]{3,}\/[a-zA-Z0-9]+\t/", $line) ) {
				//Tax office name / Tax Reference / Tax Code / NI Number
				if($dbg) echo "SUCCESS: Found Tax Line\n";
				//echo $line . "\n";
				$payslip['tax_office_name'] = preg_split("/\t/", $line)[0];
				$payslip['tax_office_ref'] = preg_split("/\t/", $line)[1];
				$payslip['tax_code'] = preg_split("/\t/", $line)[2];
				preg_match("/[A-Z]{2}[0-9]{6}[A-Z]/", $text, $match);
				$payslip['ni_number'] = $match[0];
				if( $payslip['tax_code'] == "" ) {
					preg_match("/[0-9]*[A-Z]\s*(NON)?CUM/", $text, $match);
					$payslip['tax_code'] = preg_replace("/\s+/", " ", $match[0] );
				}
			}else if( preg_match("/Pay/",$line) ) {
				//Pay and Allowances Title Line
				if($dbg) echo "SUCCESS: Found Pay/Allowances Title Line\n";
				//echo $line . "\n";
				$pay_allowance_titles = $line;
			}else if( preg_match("/(-?[0-9]+\.[0-9]{2}R?){2,}/", $line) ){
				//Will match the total line from the Pay / Allowances OR the Deductions column
				if($dbg) echo "SUCCESS: Found a Pay / Deductions Line\n";
				//echo $line . "\n";
				array_push($pay_allowance_lines, $line);		
			}
			else if( preg_match("/PAYE/", $line)) {
				if($dbg) echo "SUCCESS: Found Deductions Title Line\n";
				//echo $line . "\n";
				$deductions_titles = $line;
			}else if( preg_match("/GROSS\tPAY\t[0-9]*\.[0-9]*\tTAXABLE/", $line) ) {
				//Gross Pay / Taxable Pay / This Period Pensionable / This Period Taxable
				if($dbg) echo "SUCCESS: Found Gross Pay / Taxable Line\n";
				//echo $line . "\n";
				preg_match_all("/[0-9]*\.[0-9]{2}/", $line, $matches);
				$payslip['ytd_gross_pay'] = $matches[0][0];
				$payslip['ytd_taxable_pay'] = $matches[0][1];
				$payslip['tps_pensionable_pay'] = $matches[0][2];
				$payslip['tps_taxable_pay'] = $matches[0][3];
			}else if( preg_match("/NILETTER\t[A-Z]/", $line) ) {
				//NI Letter / (YTD) Tax Paid / TPS (Tax Period) / TPS (Non-taxable Pay)
				if($dbg) echo "SUCCESS: Found NI Letter Line\n";
				//echo $line . "\n";
				$payslip['ni_letter'] = preg_split("/\t/", $line)[1];
				preg_match_all("/TAX PERIOD\t[0-9]*/",$line,$matches);
				$payslip['tps_taxable_period'] = preg_split("/\t/",$matches[0][0])[1];

				preg_match_all("/[0-9]*\.[0-9]{2}/", $line, $matches);
				$payslip['ytd_tax_paid'] = $matches[0][0];
				$payslip['tps_non_taxable_pay'] = $matches[0][1];

			}else if( preg_match("/NIPAY\t[0-9]*\./", $line) ) {
				//NI Pay / Other NI Pay / Previous Taxable Pay / Frequency / Total Payments
				if($dbg) echo "SUCCESS: Found NI Pay Line\n";
				//echo $line . "\n";
				preg_match_all("/[0-9]*\.[0-9]{2}/", $line, $matches);
				if( count($matches[0]) == 3 ) {
					$payslip['ytd_ni_pay'] = $matches[0][0];
					$payslip['ytd_other_ni_pay'] = 0;
					$payslip['ytd_previous_taxable_pay'] = $matches[0][1];
					$payslip['tps_total_payments'] = $matches[0][2];
				}else if( count($matches[0]) == 4) {
					$payslip['ytd_ni_pay'] = $matches[0][0];
					$payslip['ytd_other_ni_pay'] = $matches[0][1];
					$payslip['ytd_previous_taxable_pay'] = $matches[0][2];
					$payslip['tps_total_payments'] = $matches[0][3];
				}
			}else if( preg_match("/NICONTS\t[0-9]*\./", $line) ) {
				//NI Conts / Other NI Conts / YTD Previous Tax Paid / TPS Period End Date / TPS Total Deductions
				if($dbg) echo "SUCCESS: Found NI Conts Line\n";
				//echo $line . "\n";
				$payslip['tps_period_end_date'] = preg_split("/(PERIOD END DATE\t|\tTOTAL)/", $line)[1];
				preg_match_all("/[0-9]*\.[0-9]{2}/", $line, $matches);
				if( count($matches[0]) == 3 ) {
					$payslip['ytd_ni_conts'] = $matches[0][0];
					$payslip['ytd_other_ni_conts'] = 0;
					$payslip['ytd_previous_tax_paid'] = $matches[0][1];
					$payslip['tps_total_deductions'] = $matches[0][2];
				}else if( count($matches[0]) == 4) {
					$payslip['ytd_ni_conts'] = $matches[0][0];
					$payslip['ytd_other_ni_conts'] = $matches[0][1];
					$payslip['ytd_previous_tax_paid'] = $matches[0][2];
					$payslip['tps_total_deductions'] = $matches[0][3];
				}
			}else if( preg_match("/PENSIONABLE\tPAY/",$line) ) {
				//YTD Pensionable Pay / YTD Pension Conts / TPS Pay Date / TPS Net Pay / SDREF Number / Employee Number / TPS Payment Method
				preg_match_all("/[0-9]*\.[0-9]{2}/", $line, $matches);
				$payslip['ytd_pensionable_pay'] = $matches[0][0];
				$payslip['ytd_pension_conts'] = $matches[0][1];
				$payslip['tps_net_pay'] = $matches[0][2];
				$payslip['tps_pay_date'] = preg_split("/(PAY DATE\t|\tNET)/", $line)[1];
				if( preg_match("/SDREF\tNUMBER\t[0-9]+/", $line) ) {
					$payslip['sdref'] = preg_split("/(SDREF\tNUMBER\t|\tEMPLOY)/", $line)[1];
				}else {
					$payslip['sdref'] = "";
				}
			}
		}
		
		$payslip['tps_pay_date'] = to_date($payslip['tps_pay_date']);
		$payslip['tps_period_end_date'] = to_date($payslip['tps_period_end_date']);

		//Now process the merged table data
		//$pay_allowance_lines - contains a line of imploded data (column for each ot the headings)
		if($dbg) echo "\nInfo: These are the pay lines:\n";
		if($dbg) echo "-- Pay and allowance totals:\n";
		preg_match_all("/-?[0-9]+\.[0-9]{2}R?/",$pay_allowance_lines[count($pay_allowance_lines)-2], $matches);
		$pay_totals = $matches[0];
		if($dbg) echo print_r($pay_totals);

		if($dbg) echo "--Deductions:\n";
		preg_match_all("/-?[0-9]+\.[0-9]{2}R?/",$pay_allowance_lines[count($pay_allowance_lines)-1], $matches);
		$deduction_totals = $matches[0];
		if($dbg) echo print_r($deduction_totals);
		
		if($dbg) echo "--Pay titles:\n";
		if($dbg) echo "--Script will now attempt to parse the pay / allowance descriptors\n";
		$pay_arr = array("Basic\tPay", "Add\tBasic\tPay", "Addn\t(Roster|Ros)\t(Hours|Hrs)\tNP", "Night\tDuty\t[0-9]*%", "Weekend\t(<|>)[0-9]in[0-9]-1(in[0-9])?", "Course\tExpenses", "[0-9]*\tAdditional\tHours", "[0-9]{3}\tAdd\tPayment", "Expenses\tNP\tNT\tNNI");
		$pay_human = array("Basic Pay", "Additional Hours (over 40)", "Additional Hours (OOH)", "Night Allowance", "Weekend Allowance", "Course Expenses", "Exception Reports", "Exception Reports", "Expenses");
		$final_pay_titles = array();

		for ($i=0; $i < count($pay_totals)*2; $i++) { 
			//echo "Loops $i\n";
			//echo "--\tString is $pay_allowance_titles\n";
			if( preg_match("/^\s*$/", $pay_allowance_titles) ) {
				if($dbg) echo "SUCCESS: String Empty\n";
				break;
			}
			for ($j=0; $j < count($pay_arr); $j++) { 
				if( preg_match("/^\s*" . $pay_arr[$j] . "\tArrs/",$pay_allowance_titles) ) {
					//echo "$i . $j . SUCCESS: Found: " . $pay_arr[$j] . "[" . $pay_human[$j] . " - Arrears]\n";
					$pay_allowance_titles = preg_replace("/^\s*" . $pay_arr[$j] . "\tArrs/", "", $pay_allowance_titles);
					//echo "\tString is now $pay_allowance_titles\n";
					array_push($final_pay_titles, $pay_human[$j] . " Arrears");
				}
				else if( preg_match("/^\s*" . $pay_arr[$j] . "/",$pay_allowance_titles) ) {
					//echo "$i . $j . SUCCESS: Found: " . $pay_arr[$j] . "[" . $pay_human[$j] . "]\n";
					$pay_allowance_titles = preg_replace("/^\s*" . $pay_arr[$j] . "/", "", $pay_allowance_titles);
					//echo "\tString is now $pay_allowance_titles\n";
					array_push($final_pay_titles, $pay_human[$j]);
				}
			}
		}

		if($dbg) echo "\n\nPAY TITLES FINAL:\n";
		if($dbg) echo print_r($final_pay_titles);




		if($dbg) echo "--Deduction titles:\n";
		if($dbg) echo "--Script will now attempt to parse the deduction descriptors\n";
		$deductions_arr = array("PAYE", "NI[A-Z]", "NHS\tPension\t[0-9]*\.[0-9]*%", "Student\tLoan", "[0-9]*\t*CRB\t*Enhanced-Mul", "(Car\tParking|Parking)", "Pension\tArrs");
		$deductions_human = array("PAYE", "National Insurance", "Pension", "Student Loan", "CRB Check", "Parking", "Pension Arrears");
		$final_deduction_titles = array();
		for ($i=0; $i < count($deduction_totals)*2; $i++) { 
			//echo "Loops $i\n";
			//echo "String is $deductions_titles\n";
			if( preg_match("/^\s*$/", $deductions_titles) ) {
				if($dbg) echo "SUCCESS: String Empty\n";
				break;
			}
			for ($j=0; $j < count($deductions_arr); $j++) { 
				if( preg_match("/^\s*" . $deductions_arr[$j] . "/",$deductions_titles) ) {
					//echo "$i . $j . SUCCESS: Found: " . $deductions_arr[$j] . "[" . $deductions_human[$j] . "]\n";
					$deductions_titles = preg_replace("/^\s*" . $deductions_arr[$j] . "/", "", $deductions_titles);
					array_push($final_deduction_titles, $deductions_human[$j]);
				}
			}
		}

		if($dbg) echo "\n\nDEDUCTIONS TITLES FINAL:\n";
		if($dbg) echo print_r($final_deduction_titles);

		if( count($final_pay_titles) == count($pay_totals) ) {
			if($dbg) echo "SUCCESS: Allocated all Pay/Allowances\n";
			$pay_full = array_combine($final_pay_titles, $pay_totals);
		}else {
			if($dbg) echo "ERROR: Could not identify all the Pay/Allowance Lines\n";
			$i = 0;
			$pay_full = array();
			while ($i < count($pay_totals) ) {
				$pay_full["Pay_Allowance_$i"] = $pay_totals[$i];
				$i++;
			}
		}


		if( count($final_deduction_titles) == count($deduction_totals) ) {
			if($dbg) echo "SUCCESS: Allocated all Deductions\n";
			$deductions_full = array_combine($final_deduction_titles, $deduction_totals);
		}else {
			if($dbg) echo "ERROR: Could not identify all the deductions\n";
			$i = 0;
			$deductions_full = array();
			while( $i < count($deduction_totals) ) {
				$deductions_full["Deductions_$i"] = $deduction_totals[$i];
				$i++;
			}
		}
		


		if($dbg) echo "\nPAY\n";
		if($dbg) echo print_r($pay_full);

		if($dbg) echo "\nDEDUCTIONS\n";
		if($dbg) echo print_r($deductions_full);

		$payslip['pay'] = $pay_full;
		$payslip['deductions'] = $deductions_full;


		if($dbg) echo "\n\nPAYSLIP:\n";
		if($dbg) echo print_r($payslip);	

		//echo "\n\n\n$text";
		
		return $payslip;
	}

	echo print_r(parse_payslip('payslips/2019-02.pdf', 1));

?>
