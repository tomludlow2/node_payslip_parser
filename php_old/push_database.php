<?php
	
	
	//Reqire the Parse Payslip Function
	require "parse_payslip.php";

	function push_to_database($file, $debug = 0) {
		//This script calls the parse_payslip function and pushes it to the database		
		//Parse the payslip and receive the array
		//Debug produces output if required
		require "conn.php";

		$ps = parse_payslip($file, $debug);
		//Generate the hash and check that the file has not already been parsed. 
		$hash = md5(serialize($ps));
		if( check_hash($hash, $conn) != 1 ) {
			//This has already been hashed
			echo( "WARNING: This file has already been hashed ($hash), it is stored as row number " . check_hash($hash, $conn)[1] . "\n" );
			return;
		}
		//Check integrity - looking for 37 fields (lack of 37  fields doesn't necessarily mean lack of integrity, but for my table requires this)
		if( count($ps) != 37 ) {
			echo( "\nERROR: The parse function does not contain enough fields\nExpected:37, count " . count($ps));
			return;
		}else {
			//Next, create the insertion statement to the `payslips` table
			$query = create_statement($ps);
			//Run the query
			if( mysqli_query($conn, $query) ) {
				echo "\nSUCCESS: Payslip inserted into the database\n";
				//Collect the ID for this query
				$id = mysqli_insert_id($conn);
				//Next, create the insertion statement to the `pay_deduct` table
				$pay_deduct_query = create_pay_deduct($ps, $id);
				if( mysqli_query($conn, $pay_deduct_query) ) {
					echo "\nSUCCESS: Pay and Deductions inserted into the database\n";
					//Now create a hash and add this to the parsed_payslips table
					$hash_q = "INSERT INTO `parsed_payslips` (`payslip_ref`, `hash`) VALUES ($id, '$hash');";
					if( mysqli_query($conn, $hash_q) ) {
						echo "\nSUCCESS: Hash check added\n";
					}else {
						echo "\nERROR: Hash insertion could not occur\n" . mysqli_error($conn);
					}
				}else {
					echo "\nERROR: Database Error\n" . mysqli_error($conn);
				}
			}else {
				echo "\nERROR: Database Error\n" . mysqli_error($conn);
			}
		}
	}

	function create_statement( $p ) {
		$op = "INSERT INTO `payslips` (";
		$key_str = "";
		$val_str = "";
		foreach($p as $key => $val) {			
			if( $key == "pay" || $key =="deductions" ) {
				//These are processed separately
			}else {
				$key_str .= "`$key`,";
				$val_str .= "'" . $val . "',";
			}
			
		}
		$key_str = substr($key_str,0, -1);

		$val_str = substr($val_str,0, -1);
		$op .= $key_str . ") VALUES (" . $val_str . ");";
		return $op;
	}

	function create_pay_deduct($p, $id) {
		$op = "INSERT INTO `pay_deduct` (`payslip_ref`, `title`, `type`, `value`) VALUES ";
		$pay = $p['pay'];
		foreach( $pay as $key => $val) {
			if( preg_match("/R/", $val) ) {
				$val = "-" . substr($val, 0, -1);
			}
			$op .= "($id, '$key', 'pay', '$val'),";
		}
		$ded = $p['deductions'];
		foreach ($ded as $key => $value) {
			if( preg_match("/R/", $value) ) {
				$value = "-" . substr($value, 0, -1);
			}
			$op .= "($id, '$key', 'deduction', '$value'),";
		}
		$op = substr($op, 0, -1);
		return $op;
	}

	function check_hash($hash, $conn) {
		$q = "SELECT * FROM `parsed_payslips` WHERE `hash` = '$hash';";
		$r = mysqli_query($conn, $q);
		if( mysqli_num_rows($r) == 0 ) {
			return 1;
		}else {
			//echo "\nROW FOUND: $r\n";
			$row = mysqli_fetch_assoc($r);
			//echo "\nID: " . $row['payslip_ref'] . "\n";
			return [0,$row['payslip_ref']];
		}
	}

?>
