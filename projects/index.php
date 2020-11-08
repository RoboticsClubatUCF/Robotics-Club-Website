<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 5, 2020";
$title = "Robotics Club Projects";
$currentWebmaster = "Alexandra French";
$updateDate = "November 4, 2020";
$pageDescription = "Combat, autonomy, and demonstration. Our current projects.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, current projects, bowser, citrobot, demobot";
$url = "https://robotics.ucf.edu/projects/index";
$markupImage = "https://robotics.ucf.edu/projects/assets/imgs/bowser.jpg";

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
    <img class="img-fluid rounded mb-2" src="assets/imgs/header-2020.jpg" alt="bowser">

    <!-- text content -->
    <div class="row align-items-center justify-content-center text-center">
      <div class="col-lg-12">
        <div class="container-wht-blk rounded p-3">
          <p>The Robotics Club of Cental Florida is dedicated to producing new, innovative
             robots that challenge all aspects and majors of the club each year. Our Projects
             involve mechanical, electrical, and computer engineers as well as computer scientists
             to achieve overall project goals.
          </p>
          <p>This year, our flagship robots are Citrobot, a 15lb combat robot,
             Bowser, an autonomous ground vehicle, and Demobot, a bot made to
             demonstrate various aspects of robotics. Together, they offer a comprehensive
             chance to join us as we tackle mechanical, electrical, and software challenges!
          </p>
        </div>
      </div>
    </div>
  </div>
  <!-- /.our projects -->

  <h2 class="text-center p-1 title-blk-wht">2019-2020</h2>

  <!-- projects -->
  <div class="intermediate-container-xs">
    <?php
      include_once("assets/templates/project.php");
      $project = new Project();
      
      $description = "Our autonomous ground vehicle. Bowser currently involves a complete electrical overhaul,
      object detection with both computer vision and LiDAR, simulations, and building back up mechanically. Our goal is to
      compete in the IGVC contest in 2021!";
      $project->generate("Bowser", "assets/imgs/bowser.jpg", "bowser", $description, "View Bowser", "bowser/index");
  
      $description = "Our 15lb combat robot. Citrobot currently involves a mechanical and electrical workup
      of a bot made to destroy the any and all competition.
      The competitions Citrobot will take part in have yet to be determined, but we are always open to suggestions.";
      $project->generate("Citrobot", "assets/imgs/citrobot.jpg", "citrobot", $description, "View Citrobot", "citrobot/index");
      
      $description = "Demobot is a demonstrative robot - a challenge to create a robot that can
      demonstate various aspects of robotics while remaining interesting to all.
      Demobot involves a bit of every discipline to achieve our goals.
      Demonstrations to be determined!";
      $project->generate("Demobot", "assets/imgs/demobot.jpg", "demobot", $description, "View Demobot", "demobot/index");

    ?>
  </div>
  <!-- /.projects -->

  <?php
    require_once("../assets/templates/pagination-bottom.php");
    $pagination = new Pagination("index", null, 2019);
    $pagination->generate(array("index", 2019, 2018, 2017), TRUE);
  ?>

  </div>
  <!-- /.container -->

<?php

// footer functions and include
include_once("../assets/templates/footer.php");

?>
