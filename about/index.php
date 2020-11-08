<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 5, 2020";
$title = "About The Robotics Club";
$currentWebmaster = "Alexandra French";
$updateDate = "November 4, 2020";
$pageDescription = "The Robotics Club of Central Florida is a student club focused on exploring and advancing robotics.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, about, about us, new members, welcome, mission";
$url = "https://robotics.ucf.edu/about/index";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");


// page content
include_once('assets/templates/about-us.html');
include_once('assets/templates/our-officers.php');
include_once('assets/templates/our-advisors.html');
?>

  <!-- Page Content -->
  <div class="container">
    <!-- members -->
      <?php
      // members list addition
      $csvFile = "assets/misc/membersList-Fa2020.csv";
      $membersTitle = "Our Members";
      $membersTitleColor = "gold";
      include_once('../assets/templates/members-list.php');
      ?>
    <!-- /.members -->
    <!-- past members -->
    <div class="row align-items-center justify-content-center">
      <div class="col-sm-10">
        <h3 class="title-blk-gold p-2 text-center invert"><a href="past-members">View Past Members</a> </h3>
      </div>
    </div>
    <!-- /.past members -->
  </div>
  <!-- /.container -->

<?php
// footer functions and include
include_once("../assets/templates/footer.php");
?>
