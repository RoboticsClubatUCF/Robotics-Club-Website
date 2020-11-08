<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 5, 2020";
$title = "Robotics Club 2018 Projects";
$currentWebmaster = "Alexandra French";
$updateDate = "November 4, 2020";
$pageDescription = "In 2018, The Robotics Club of Central Florida projects were Kitt, a roboboat, that was led by Lakitu, an autonomous quadcopter.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, past projects 2018, past projects, lakitu, kitt";
$url = "https://robotics.ucf.edu/projects/2018";
$markupImage = "https://robotics.ucf.edu/projects/assets/imgs/lakitu.jpg";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");

?>

<!-- Page Content -->
<div class="container">

  <!-- our projects header -->
  <div class="header-container-sm">
    <h1 class="mt-4 mb-3 text-center rounded p-1 title-blk-gold">Our Projects
    </h1>

    <!-- Image Header -->
    <img class="img-fluid rounded mb-2" src="assets/imgs/header-2018.jpg" alt="bowser">

    <!-- text content -->
    <div class="row align-items-center justify-content-center text-center">
      <div class="col-lg-12">
        <div class="container-wht-blk rounded p-3">
          <p>The Robotics Club of Cental Florida is dedicated to producing new, innovative
             robots that challenge all aspects and majors of the club each year. Our Projects
             involve mechanical, electrical, and computer engineers as well as computer scientists
             to achieve overall project goals.
          </p>
          <p>For 2017-2018, our flagship robots were Lakitu, an autonomous quadcopter, and KITT,
              an roboboat directed by Lakitu. Together, they offered a comprehensive
             chance to tackle mechanical and software challenges!
          </p>
        </div>
      </div>
    </div>
  </div>
  <!-- /.our projects -->

  <h2 class="text-center p-1 title-blk-wht">2017-2018</h2>

  <!-- projects -->
  <div class="intermediate-container-xs">
    <?php
      include("assets/templates/project.php");
      $project = new Project();
      
      $description = "A roboboat. Kitt involved heavy mechanical and computer science work to
      achieve a boat that can achieve high speeds while recieving signals to avoid objects from an
      autonomous quadcopter, Lakitu. Competed in Roboboat 2018.";
      $project->generate("Kitt", "../assets/imgs/placeholder-700x300.png", "kitt", $description, "View Kitt", "kitt/index");
  
      $description = "An autonomous quadcopter. Lakitu involved heavy computer vision work to achieve a
      quadcopter that could drive and direct itself and Kitt, a roboboat.
      Competed in Roboboat 2018.";
      $project->generate("Lakitu", "assets/imgs/lakitu.jpg", "lakitu", $description, "View Lakitu", "lakitu/index");
    ?>
  </div>
  <!-- /.projects -->

  <?php
    require_once("../assets/templates/pagination-bottom.php");
    $pagination = new Pagination(2018, 2019, 2017);
    $pagination->generate(array("index", 2019, 2018, 2017), TRUE);
  ?>
  
  </div>
  <!-- /.container -->

<?php

// footer functions and include
include_once("../assets/templates/footer.php");

?>
