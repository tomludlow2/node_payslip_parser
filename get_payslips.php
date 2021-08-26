<?php

	function get_payslips() {
		$conn = mysqli_connect("localhost", "money", "C2BXHHR7Dk2kv8yw", "money");
		$query = "SELECT `id` as `Payslip Reference`, `tps_pay_date` as `Pay Date`, `location` as  `Workplace`, `department` as `Department`, `job_title` as `Job`, `payscale_description` as `Role`, `tps_total_payments` as `Gross Pay`, `tps_total_deductions` as `Deductions`, `tps_net_pay` as `Net Pay` FROM `payslips` ORDER BY `tps_pay_date` ASC";
		$r = mysqli_query($conn, $query);
		if( $r ) {
			$output_rows = [];
			while($row = mysqli_fetch_assoc($r) ) {
				//Get specific bits required:
				$query2 = "SELECT * FROM `pay_deduct` WHERE `payslip_ref`='" . $row['Payslip Reference'] . "';";
				$r2 = mysqli_query($conn, $query2);
				if( $r2 ) {
					$arr = ["Basic Pay"=>0, "PAYE"=>0, "N Insurance"=>0, "Pension"=>0, "Student Loan"=>0];
					while( $row2 = mysqli_fetch_assoc($r2) ) {
						if($row2['title'] == "Basic Pay") {
							$arr["Basic Pay"] = $row2['value'];
						}else if($row2['title'] == "PAYE") {
							$arr["PAYE"] = $row2['value'];
						}else if($row2['title'] == "National Insurance") {
							$arr["N Insurance"] = $row2['value'];
						}else if($row2['title'] == "Pension") {
							$arr["Pension"] = $row2['value'];
						}else if($row2['title'] == "Student Loan") {
							$arr["Student Loan"] = $row2['value'];
						}
					}
					$merge_array = array_merge($row, $arr);
					unset($merge_array["Payslip Reference"]);
				}

				array_push($output_rows, $merge_array);
			}
			return $output_rows;
		}else {
			return ["error"=>"Database Query Failed"];
		}
	}

?>
