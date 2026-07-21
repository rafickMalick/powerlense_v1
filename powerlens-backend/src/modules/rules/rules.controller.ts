// rules.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { RulesService } from './rules.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';

@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() data: CreateRuleDto) {
    return this.rulesService.createRule(data);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.rulesService.getAllRules();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.rulesService.getRuleById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdateRuleDto) {
    return this.rulesService.updateRule(id, data);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  disable(@Param('id') id: string) {
    return this.rulesService.disableRule(id);
  }
}
