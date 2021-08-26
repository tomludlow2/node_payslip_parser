# php_nhs_payslip_parser

*First Git Upload, uses the smalot/pdfparser but using subrepo was too complex so just included the file in the directory structure
Use this to import your NHS Payslips into associative arrays (and then do what you want with them)

## SETUP
clone https://github.com/smalot/pdfparser
## Then
In parse_payslip.php
- change the inlcude to the alt_autoload.php-dist file from wherever you cloned the smalot repo
- add whichever payslips you want to parse to /payslips
- To test:
- - Uncomment line #288 //echo print_r(parse_payslip('payslips/2019-09.pdf', 1));
- - Change the pdf file to one that is in your payslips folder
- run the script

Other files are all to do with inserting them automatically into a database
- Create a database - sql file included for this
- Run:  mv conn_sample.php conn.php
- Run: nano conn.php
- change the login details to your server's login details

## Then:
Run: php run_all.php
This will open all your pdf files in the directory
It will push them all to the server

## Then to get the info from the server:
- php get_payslips.php
- This is an example file that shows you how you might extract various bits from the server
