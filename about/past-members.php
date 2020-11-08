<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 25, 2020";
$title = "Past Robotics Club Members";
$currentWebmaster = "Alexandra French";
$updateDate = "November 4, 2020";
$pageDescription = "The Robotics Club of Central Florida has a history of all members in the 2020s for viewing.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, past members, 2020s, current memebrs, past members 2020s";
$url = "https://robotics.ucf.edu/about/past-members";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");
?>

<!-- Page Content -->
<div class="container">

  <!-- past members -->
  <div class="header-container-sm">
    <h1 class="mt-4 mb-3 text-center rounded p-1 title-blk-gold">Past Members
    </h1>

    <!-- text content -->
    <div class="row align-items-center justify-content-center text-center">
      <div class="col-lg-12">
        <div class="container-wht-blk rounded p-3">
          <p>The Robotics Club of Cental Florida has been a long running club. This page exists
            to help capture the history of our members. Here you can see our history throughout the 2020s.
          </p>
        </div>
      </div>
    </div>
  </div>
  <!-- /.past members -->

  <!-- tabs for year segments -->
  <ul class="nav nav-tabs wht-tabs">
   <li class="nav-item rounded-top">
     <a class="nav-link active" href="past-members">2020s</a>
   </li>
   <li class="nav-item rounded-top">
     <a class="nav-link" href="past-members-2010s">2010s</a>
   </li>
  </ul>
  <!-- /.tabs for year segments -->

  <?php
    // all memebr year and semester tabs
    $memberYears = array(
      "2020" => array("Fall", "Spring"));
    include_once("assets/templates/members-by-semester.php");
  ?>

  </div>
  <!-- /.page content -->


<?php
// footer functions and include
include_once("../assets/templates/footer.php");

?>
