<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 25, 2020";
$title = "Robotics Club Past Officers (2010s)";
$currentWebmaster = "Alexandra French";
$updateDate = "November 5, 2020";
$pageDescription = "The Robotics Club of Central Florida has kept a history of all past officers in the 2010s.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, current officers, past officers 2020s, past officers 2020";
$url = "https://robotics.ucf.edu/about/past-officers-2010s";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");
?>



  <!-- Page Content -->
  <div class="container">

    <!-- past officers -->
    <div class="header-container-sm">
      <h1 class="mt-4 mb-3 text-center rounded p-1 title-blk-gold">Past Officers
      </h1>

      <!-- text content -->
      <div class="row align-items-center justify-content-center text-center">
        <div class="col-lg-12">
          <div class="container-wht-blk rounded p-3">
            <p>The Robotics Club of Cental Florida has been a long running club. This page exists
              to help capture the history of our officers. Here you can find all of our officers, all
              the way back to 2015.
            </p>
          </div>
        </div>
      </div>
    </div>
    <!-- /.past officers -->

    <!-- tabs for year -->
    <ul class="nav nav-tabs wht-tabs">
     <li class="nav-item rounded-top">
       <a class="nav-link" href="past-officers">2020s</a>
     </li>
     <li class="nav-item rounded-top">
       <a class="nav-link active" href="past-officers-2010s">2010s</a>
     </li>
    </ul>
    <!-- tabs for year -->

    <!-- tabs for officers -->
    <ul class="mini-tabs nav nav-tabs rounded-top">
      <li class="nav-item rounded-top">
        <a class="nav-link active" data-toggle="tab" href="#fa2019">2019-20</a>
      </li>
      <li class="nav-item rounded-top">
        <a class="nav-link" data-toggle="tab" href="#fa2018">2018-19</a>
      </li>
      <li class="nav-item rounded-top">
        <a class="nav-link" data-toggle="tab" href="#fa2017">2017-18</a>
      </li>
      <li class="nav-item rounded-top">
        <a class="nav-link" data-toggle="tab" href="#fa2016">2016-17</a>
      </li>
      <li class="nav-item rounded-top">
        <a class="nav-link" data-toggle="tab" href="#fa2015">2015-16</a>
      </li>
    </ul>

<?php

// lengthy officer generation
include_once('assets/templates/officers-2010.php');

?>

  </div>
  <!-- /.page content -->

<?php

// footer functions and include
include_once("../assets/templates/footer.php");

?>
