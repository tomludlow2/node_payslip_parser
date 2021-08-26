-- phpMyAdmin SQL Dump
-- version 4.6.6deb5
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Aug 26, 2021 at 02:34 PM
-- Server version: 10.3.29-MariaDB-0+deb10u1
-- PHP Version: 7.3.29-1~deb10u1

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `money`
--

-- --------------------------------------------------------

--
-- Table structure for table `parsed_payslips`
--

CREATE TABLE `parsed_payslips` (
  `id` int(11) NOT NULL,
  `payslip_ref` int(11) NOT NULL,
  `hash` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------

--
-- Table structure for table `payslips`
--

CREATE TABLE `payslips` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `assignment` int(255) NOT NULL,
  `location` varchar(255) NOT NULL,
  `department` varchar(255) NOT NULL,
  `job_title` varchar(255) NOT NULL,
  `salary` float NOT NULL,
  `pt_salary` float NOT NULL,
  `payscale_description` varchar(255) NOT NULL,
  `hours` float NOT NULL,
  `tax_office_name` varchar(255) NOT NULL,
  `tax_office_ref` varchar(255) NOT NULL,
  `tax_code` varchar(255) NOT NULL,
  `ni_number` varchar(255) NOT NULL,
  `ni_letter` varchar(2) NOT NULL,
  `sdref` varchar(255) NOT NULL,
  `tps_pensionable_pay` float NOT NULL,
  `tps_taxable_pay` float NOT NULL,
  `tps_taxable_period` int(2) NOT NULL,
  `tps_non_taxable_pay` float NOT NULL,
  `tps_total_payments` float NOT NULL,
  `tps_period_end_date` date NOT NULL,
  `tps_total_deductions` float NOT NULL,
  `tps_net_pay` float NOT NULL,
  `tps_pay_date` date NOT NULL,
  `ytd_gross_pay` float NOT NULL,
  `ytd_taxable_pay` float NOT NULL,
  `ytd_tax_paid` float NOT NULL,
  `ytd_ni_pay` float NOT NULL,
  `ytd_other_ni_pay` float NOT NULL,
  `ytd_previous_taxable_pay` float NOT NULL,
  `ytd_ni_conts` float NOT NULL,
  `ytd_other_ni_conts` float NOT NULL,
  `ytd_previous_tax_paid` float NOT NULL,
  `ytd_pensionable_pay` float NOT NULL,
  `ytd_pension_conts` float NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------

--
-- Table structure for table `pay_deduct`
--

CREATE TABLE `pay_deduct` (
  `id` int(11) NOT NULL,
  `payslip_ref` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `type` varchar(10) NOT NULL DEFAULT 'pay',
  `value` float NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `parsed_payslips`
--
ALTER TABLE `parsed_payslips`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `payslips`
--
ALTER TABLE `payslips`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `pay_deduct`
--
ALTER TABLE `pay_deduct`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `parsed_payslips`
--
ALTER TABLE `parsed_payslips`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=36;
--
-- AUTO_INCREMENT for table `payslips`
--
ALTER TABLE `payslips`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=36;
--
-- AUTO_INCREMENT for table `pay_deduct`
--
ALTER TABLE `pay_deduct`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=298;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
